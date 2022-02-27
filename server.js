"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let Path = require("path");
let request = require("@root/request");

let TokenMap = require("./tokens.json");
let GenToken = require("./lib/gentoken.js");
let Script = require("./script.js");
let Base58Check = require("./base58check.js");

let bodyParser = require("body-parser");
let app = require("@root/async-router").Router();
let express = require("express");
let server = express();
server.use("/", app);

let dashcore = require("@dashevo/dashcore-node");
let config = require(Path.resolve(process.env.DASH_CONFIG));

let node = dashcore.scaffold.start({
  path: process.env.DASH_PATH,
  config: config,
});

let defaultWebhookTimeout = 5 * 1000;
let defaultStaleAge = 15 * 60 * 1000;
let staleAge = parseInt(process.env.STALE_AGE, 10) || defaultStaleAge;
let registeredAddresses = {};

function getRegistered(p2pkh) {
  return registeredAddresses[p2pkh];
}

node.on("ready", function () {
  node.services.dashd.on("tx", function (txData) {
    // a new transaction has entered the mempool
    //console.log("txData", txData);
    let tx = new dashcore.lib.Transaction(txData);
    //let json = JSON.stringify(tx, null, 2);
    //console.log("tx:", json);

    tx.outputs.some(async function (output) {
      let out = output.toJSON();

      let script = out.script.toString();
      let p2pkh;
      try {
        p2pkh = Script.parsePubKeyHash(script);
      } catch (e) {
        return;
      }

      //console.log(`DEBUG: ${out.satoshis} => ${p2pkh}`);

      let account = getRegistered(p2pkh);
      if (!account) {
        return;
      }

      console.info(`Target: ${out.satoshis} => ${p2pkh}`);
      let req = {
        timeout: defaultWebhookTimeout,
        auth: {
          username: account.username,
          password: account.password,
        },
        url: account.url,
        json: { address: account.address, satoshis: out.satoshis },
      };
      await request(req)
        .then(function (resp) {
          if (!resp.ok) {
            console.error(resp.toJSON());
            throw new Error("bad response from webhook");
          }
        })
        .catch(function (e) {
          console.error(`Webhook Failed:`);
          console.error(e.message || e.stack);
        });
    });

    // TODO calc the fee just for fun
    // fee = sum(inputs) - sum(outputs)
  });
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

app.use(
  "/api",
  bodyParser.json({
    limit: "100kb",
    strict: true,
  })
);

app.post("/api/webhooks", auth, async function (req, res) {
  let data = {
    url: req.body.url,
    address: req.body.address,
  };
  let account = req.account;

  let url;
  try {
    url = new URL(data.url);
  } catch (e) {
    throw new Error(`BAD_REQUEST: invalid webhook url '${data.url}'`);
  }
  if (!account.hostnames.includes(url.hostname)) {
    throw new Error(`BAD_REQUEST: untrusted hostname '${url.hostname}'`);
  }
  if ("https:" !== url.protocol) {
    throw new Error(`BAD_REQUEST: insecure webhook url '${url.protocol}'`);
  }

  let addr;
  try {
    addr = Base58Check.verify(data.address);
  } catch (e) {
    throw new Error("BAD_REQUEST: invalid dash address");
  }

  // fn: test that valid auth succeeds
  if (!url.username) {
    url.username = "dwh";
  }
  if (!url.password) {
    url.password = req.token;
  }

  await request({
    timeout: defaultWebhookTimeout,
    url: data.url,
    auth: {
      username: url.username,
      password: url.password,
    },
    json: {
      address: data.address,
      satoshis: 0,
    },
  })
    .then(function (resp) {
      if (!resp.ok) {
        throw new Error(
          `BAD_REQUEST: webhook test did not respond with 2xx OK: ${resp.statusCode}`
        );
      }
      if (0 !== resp.body.satoshis) {
        throw new Error(
          `BAD_REQUEST: webhook test did not respond with Content-Type: application/json and '{ "satoshis": 0 }'`
        );
      }
      return resp;
    })
    .catch(function (e) {
      if (e.message.startsWith("BAD_REQUEST:")) {
        throw e;
      }
      throw new Error(
        `BAD_REQUEST: webhook test failed network connection: ${e.message}`
      );
    });

  // fn: test that invalid auth fails
  await request({
    timeout: defaultWebhookTimeout,
    url: req.body.url,
    json: { address: data.address, satoshis: 0 },
  }).then(function (resp) {
    if (resp.ok) {
      throw new Error("BAD_REQUEST: unauthenticated webhook test did not fail");
    }
  });

  // Note: we can only have one webhook per address this way:
  registeredAddresses[addr.pubKeyHash] = {
    ts: Date.now(),
    address: data.address,
    username: url.username,
    password: url.password,
    url: data.url,
  };
  console.log("DEBUG", addr.pubKeyHash, registeredAddresses);

  if (url.password) {
    let prefix = url.password.slice(0, 4);
    let mask = "*".repeat(url.password.length - 6);
    let last2 = url.password.slice(-2);
    url.password = `${prefix}${mask}${last2}`;
  }
  res.json({
    url: url.toString(),
    address: data.address,
  });

  // TODO set this on an weak-ref interval?
  cleanup();
});

function cleanup() {
  let freshtime = Date.now() - staleAge;
  Object.keys(registeredAddresses).forEach(function (key) {
    if (registeredAddresses[key].ts > freshtime) {
      return;
    }
    delete registeredAddresses[key];
  });
}

app.use("/api", function (err, req, res, next) {
  res.statusCode = 400;
  res.json({
    status: err.status,
    code: err.code,
    message: err.message,
  });
});

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
