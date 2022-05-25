"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let Path = require("path");
let Os = require("os");
let spawn = require("child_process").spawn;

let TokenMap = require("./tokens.json");
let GenToken = require("./lib/gentoken.js");
let Script = require("./script.js");
let Base58Check = require("./base58check.js");

let request = require("./lib/request.js");
let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();

server.set("json spaces", 2);
server.use("/", app);

let dashcore = require("@dashevo/dashcore-node");
let config = require(Path.resolve(process.env.DASH_CONFIG));

let node = dashcore.scaffold.start({
  path: process.env.DASH_PATH,
  config: config,
});

let staleAge = parseInt(process.env.STALE_AGE, 10);
let HooksDb = require("./hooks-db.js").create({
  staleAge,
});

let defaultWebhookTimeout = 5 * 1000;
let Hooks = require("./webhooks.js").create({
  defaultWebhookTimeout,
  Db: HooksDb,
});

node.on("ready", function () {
  node.services.dashd.on("tx", createTxListener("tx"));
  node.services.dashd.on("txlock", createTxListener("txlock"));
  //node.services.dashd.on("tx", createTxListener("tx    "));

  function createTxListener(evname) {
    return function (txData) {
      // a new transaction has entered the mempool
      //console.log("txData", txData);
      let tx = new dashcore.lib.Transaction(txData);

      //let json = JSON.stringify(tx, null, 2);
      //console.log(`DEBUG [${evname}] tx:`, json);

      tx.outputs.some(async function (output) {
        let out = output.toJSON();

        let script = out.script.toString();
        let p2pkh;
        try {
          p2pkh = Script.parsePubKeyHash(script);
        } catch (e) {
          return;
        }

        let payAddr = Base58Check.encode({
          version: `4c`,
          pubKeyHash: p2pkh,
        });
        console.log(`[${evname}] DEBUG: ${out.satoshis} => ${payAddr}`);

        let account = HooksDb.getByPubKeyHash(p2pkh);
        if (!account) {
          return;
        }

        console.info(`[${evname}] Target: ${out.satoshis} => ${payAddr}`);
        let req = {
          timeout: defaultWebhookTimeout,
          auth: {
            username: account.username,
            password: account.password,
          },
          url: account.url,
          json: {
            txid: tx.hash,
            event: evname,
            instantsend: "txlock" === evname,
            address: account.address,
            // TODO duffs
            satoshis: out.satoshis,
          },
        };
        await request(req)
          .then(function (resp) {
            if (!resp.ok) {
              console.error(`[${evname}] not OK:`);
              console.error(resp.toJSON());
              throw new Error("bad response from webhook");
            }
          })
          .catch(function (e) {
            console.error(`[${evname}] Webhook Failed:`);
            console.error(e.message || e.stack);
          });
      });

      // TODO calc the fee just for fun
      // fee = sum(inputs) - sum(outputs)
    };
  }
});

function auth(req, res, next) {
  // `Bearer token` => `token`
  let token = (req.headers.authorization || ``).split(" ")[1] || ``;
  if (!token) {
    throw new Error("no bearer token");
  }

  let hash = GenToken.hash(token, 24);
  //console.log("token:", token.slice(0, 6), token.slice(-2));
  //console.log("hash:", hash.slice(0, 2), hash.slice(-2));
  //console.log();

  let details = TokenMap[hash];
  if (!details) {
    throw new Error("invalid token");
  }

  req.token = token;
  req.account = { hostnames: details.hostnames };
  next();
}

app.use("/api", bodyParser.json({ limit: "100kb", strict: true }));
app.post("/api/webhooks", auth, Hooks.register);

app.get("/api/mnlist", rListServiceNodes);
app.get("/api/mnlist-testnet", rListTestServiceNodes);

app.use("/api", finalErrorHandler);

let mninfo = {};
mninfo.isFresh = function () {
  let now = Date.now();
  let fresh = now - mninfo.updatedAt < 15 * 60 * 1000;
  return fresh;
};

mninfo.update = async function () {
  let homedir = Os.homedir();
  let conf = `${homedir}/${process.env.DASHD_CONF}`;
  let out = await exec("dash-cli", [
    `-conf=${conf}`,
    "masternodelist",
    "json",
    "ENABLED",
  ]);
  mninfo.mnlistTxt = JSON.stringify(JSON.parse(out.stdout), null, 2);
  mninfo.updatedAt = Date.now();
  await mninfo.updateTestnet().catch(console.error);
};

mninfo.updateTestnet = async function () {
  let homedir = Os.homedir();
  let conf = `${homedir}/${process.env.DASHD_TESTNET_CONF}`;
  let out = await exec("dash-cli", [
    "-testnet",
    `-conf=${conf}`,
    "masternodelist",
    "json",
    "ENABLED",
  ]);
  mninfo.tnlistTxt = JSON.stringify(JSON.parse(out.stdout), null, 2);
};

async function rListServiceNodes(req, res) {
  res.setHeader("Content-Type", "application/json");

  let replied = false;
  if (mninfo.mnlistTxt) {
    res.end(mninfo.mnlistTxt);
    replied = true;
  }

  if (mninfo.isFresh()) {
    return;
  }

  await mninfo.update();

  if (!replied) {
    res.end(mninfo.mnlistTxt);
  }
}

async function rListTestServiceNodes(req, res) {
  res.setHeader("Content-Type", "application/json");

  let replied = false;
  if (mninfo.tnlistTxt) {
    res.end(mninfo.tnlistTxt);
    replied = true;
  }

  if (mninfo.isFresh()) {
    return;
  }

  await mninfo.update();

  if (!replied) {
    res.end(mninfo.tnlistTxt);
  }
}

async function exec(exe, args) {
  return new Promise(function (resolve, reject) {
    let cmd = spawn(exe, args);

    let stdout = [];
    let stderr = [];

    cmd.stdout.on("data", function (data) {
      stdout.push(data.toString("utf8"));
    });

    cmd.stderr.on("data", function (data) {
      stderr.push(data.toString("utf8"));
    });

    cmd.on("close", function (code) {
      let result = {
        code: code,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      };

      if (!code) {
        resolve(result);
        return;
      }

      reject(result);
    });
  });
}

function finalErrorHandler(err, req, res, next) {
  res.statusCode = 400;
  res.json({
    status: err.status,
    code: err.code,
    message: err.message,
  });
}

// TODO
// Register an address and a webhook
// Fire webhooks when a transaction with a matching address comes in

module.exports = server;

if (require.main === module) {
  let PORT = process.env.PORT || 3274; // DASH
  let Http = require("http");
  let httpServer = Http.createServer(server);

  httpServer.listen(PORT, function () {
    console.info(`Listening on`, httpServer.address());
  });
}
