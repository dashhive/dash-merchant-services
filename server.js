"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let Path = require("path");
let Os = require("os");

let TokenMap = require("./tokens.json");
let GenToken = require("./lib/gentoken.js");
// let Script = require("./script.js");
// let Base58Check = require("@root/base58check").Base58Check;
// let b58c = Base58Check.create();

let Events = require("./events.js");

let DashTx = require("./parse-tx.js");
let RpcClient = require("@dashevo/dashd-rpc/promise");
let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();

server.set("json spaces", 2);
server.use("/", app);

// let dashcore = require("@dashevo/dashcore-node");
let configPath = Path.resolve(process.env.DASH_CONFIG);
let config = require(configPath);
console.log(JSON.stringify(config, null, 2));

// let node = dashcore.scaffold.start({
//   path: process.env.DASH_PATH,
//   config: config,
// });

let staleAge = parseInt(process.env.STALE_AGE, 10);
let HooksDb = require("./hooks-db.js").create({
  staleAge,
});

let Hooks = require("./webhooks.js").create({
  defaultWebhookTimeout: 5 * 1000,
  Db: HooksDb,
});

let dashdConf = config.servicesConfig.dashd.connect[0];
let rpcConfig = {
  // https for remote, http for local / private networking
  protocol: "http",
  user: dashdConf.rpcuser,
  pass: dashdConf.rpcpassword,
  host: dashdConf.rpchost || "127.0.0.1", // "10.11.5.101",
  // mainnet=9998, testnet=19998, regtest=19898
  port: dashdConf.rpcport || 9998,
};
let rpc = new RpcClient(rpcConfig);

const E_RPC_IN_WARMUP = -28;
let rpcConnected = false;
async function sleep(ms) {
  return await new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
async function initRpc() {
  let ready = await rpc.getBestBlockHash().catch(function (e) {
    if (!rpcConnected) {
      rpcConnected = true;
      console.info("[INFO] RPC is connected.");
    }

    if (e.code === E_RPC_IN_WARMUP) {
      console.warn(`[WARN] RPC is not fully synced: ${e.message}`);
      return;
    }

    throw e;
  });

  if (ready) {
    console.info("[INFO] RPC is ready.");
    return;
  }

  await sleep(5000);
  await initRpc();
}
initRpc();

void Events.create({
  url: process.env.DASHD_ZMQ_URL,
  handler: createTxListener(),
});

let parses = Promise.resolve();
function createTxListener(evname) {
  return async function (err, type, value) {
    if (err) {
      console.error(err.stack || err);
      return;
    }

    let typename = type.toString();

    if (typename === "hashchainlock") {
      console.info(`[monitor] ${type}: TODO clear double-old rawtxlock utxos`);
      return;
    }

    if (typename !== "rawtxlock") {
      console.info(`[monitor] ${type}`);
      return;
    }

    console.info(`[monitor] ${type}:`);
    console.info(value);

    let txInfo;
    parses = parses
      .then(async function () {
        txInfo = await DashTx.parse(value);
      })
      .catch(function () {
        console.warn("ignoring script that could not be parsed");
      });
    await parses;
    if (!txInfo) {
      return;
    }

    console.log(`[DEBUG] txInfo`, txInfo);

    let pkhs = [];
    for (let output of txInfo.outputs) {
      pkhs.push(output.pubKeyHash);
    }

    await Hooks.send(typename, txInfo, pkhs).catch(function (e) {
      console.error(`[${evname}] Webhook Failed:`);
      console.error(e.message || e.stack);
    });

    // TODO calc the fee just for fun
    // fee = sum(inputs) - sum(outputs)
  };
}

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

app.get("/api/utxos", async function (req, res) {
  let addressesStr = req.query.addresses || "";
  addressesStr = addressesStr.trim();

  let addresses = addressesStr.split(",");
  if (!addressesStr) {
    addresses = [];
  }

  // getaddressbalance
  // getaddressutxos
  let ret = await rpc.getAddressUtxos({
    addresses: addresses,
  });
  res.json(ret);
});

app.post("/api/utxos", async function (req, res) {
  let addresses = req.body?.addresses || [];
  // TODO validate address string length

  let ret = await rpc.getAddressUtxos({
    addresses: addresses,
  });
  res.json(ret);
});

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
