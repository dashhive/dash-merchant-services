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

// Monkey-Patches
// See:
// - <https://github.com/dashpay/dashd-rpc/pull/66>
// - <https://github.com/dashpay/dashd-rpc/pull/64>
// let RpcClientLegacy = require("@dashevo/dashd-rpc");
// if (!RpcClientLegacy.callspec.getRawTransactionMulti) {
//   RpcClientLegacy.callspec.getRawTransactionMulti = "obj bool";
// }
// if (!RpcClientLegacy.callspec.getTxChainLocks) {
//   RpcClientLegacy.callspec.getTxChainLocks = "obj";
// }

const SATOSHIS = 100000000;

function toDashStr(sats) {
  let dash = (sats / SATOSHIS).toFixed(8);
  return dash;
}

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
  timeout: 10 * 1000, // bump default from 5s to 10s for up to 10k addresses
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
      console.info(`[monitor] ${type} (x)`);
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

// JSON.parse is not as efficient as you'd hope, so size matters
app.use("/api", bodyParser.json({ limit: "100kb", strict: true }));
app.post("/api/webhooks", auth, Hooks.register);

function reconcileUtxosWithMempool(rpcUtxos, memCoins) {
  let utxos = rpcUtxos.slice(0);

  let spent = [];
  for (let memCoin of memCoins) {
    let rpcUtxo = memCoinToRpc(memCoin);

    if (rpcUtxo.satoshis > 0) {
      utxos.push(rpcUtxo);
    } else {
      spent.push(memCoin);
    }
  }

  let negated = [];
  for (let coin of spent) {
    for (let i = 0; i < utxos.length; i += 1) {
      let utxo = utxos[i];
      if (coin.prevtxid !== utxo.txid) {
        continue;
      }
      if (coin.prevout !== utxo.outputIndex) {
        continue;
      }

      let negatedUtxo = utxos.splice(i, 1);
      negated.push(negatedUtxo);
    }
  }

  return { utxos, spent, negated };
}

/**
 * @param {Array<String>} addresses
 * @returns {Array<RpcUtxo>}
 */
async function getInstantUtxos(addresses) {
  // getaddressutxos
  let rpcUtxosMsg = await rpc.getAddressUtxos({
    addresses: addresses,
  });
  for (let rpcUtxo of rpcUtxosMsg.result) {
    Object.assign(rpcUtxo, { confirmed: true });
  }

  // Note: is it possible for instantsend pool to run out?
  let mempoolMsg = await rpc.getAddressMempool({
    addresses: addresses,
  });
  let memTxesMap = {};
  let memTxids = [];
  for (let entry of mempoolMsg.result) {
    memTxids.push(entry.txid);
  }
  if (memTxids.length) {
    // Note: the Instant Send ISLock is NOT actually in the transaction,
    // but the RPC only gives back a string (no meta info) unless we do.
    let DECODE = true;
    let txesResult = await rpc.getRawTransactionMulti({ 0: memTxids }, DECODE);
    memTxesMap = txesResult.result;
  }
  for (let memCoin of mempoolMsg.result) {
    let tx = memTxesMap[memCoin.txid];
    if (!tx.confirmed) {
      let confirmed = tx?.instantSend || false;
      Object.assign(memCoin, { _confirmed: confirmed, _pending: !confirmed });
    }
  }

  let coinSegments = reconcileUtxosWithMempool(
    rpcUtxosMsg.result,
    mempoolMsg.result
  );
  let utxos = coinSegments.utxos;

  console.log("[DEBUG-SPENT]", coinSegments.negated);

  // getaddressdeltas
  //let deltas = await rpc.getAddressDeltas({
  //	addresses: addresses,
  //});

  //// getaddresstxids
  //let txids = await rpc.getAddressTxids({
  //	addresses: addresses,
  //});
  //if (chainlocks.length === 0) {
  //	let memTxids = [];
  //	for (let txid of txids.result) {
  //		console.log("[DEBUG-RPC] tx entry");
  //		console.log(txid);
  //		memTxids.push(txid);
  //	}
  //	console.log("[DEBUG-RPC] tx memTxids");
  //	console.log(memTxids);
  //	chainlocks = await rpc.gettxchainlocks(memTxids);
  //	//chainlocks = await rpc.gettxchainlocks({ txids: memTxids });
  //}

  let result = {
    utxos: utxos,
  };

  return result;
}

/**
 * Translates RPC UTXOs into Insight UTXOs for legacy compatibility
 * @param {Array<RpcUtxo>} rpcUtxos
 * @returns {Array<InsightUtxo>}
 *
 * Example:
 * Core UTXO Inputs:
 * [
 *   {
 *     "address": "XmCyQ6qARLWXap74QubFMunngoiiA1QgCL",
 *     "outputIndex": 0,
 *     "satoshis": 99809,
 *     "script": "76a91473640d816ff4161d8c881da78983903bf9eba2d988ac",
 *     "txId": "f92e66edc9c8da41de71073ef08d62c56f8752a3f4e29ced6c515e0b1c074a38",
 *     "height": "9001"
 *   }
 * ]
 * Insight UTXO Outputs:
 * [
 *   {
 *     "address": "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "txid": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
 *     "vout": 0,
 *     "scriptPubKey": "00000000000000000000000000000000000000000000000000",
 *     "amount": 0.01,
 *     "satoshis": 1000000,
 *     "height": 1500000,
 *     "confirmations": 200000
 *   }
 * ]
 */
function rpcUtxoToInsight(rpcUtxo) {
  let amount = toDashStr(rpcUtxo.satoshis);
  let amountFloat = parseFloat(amount);
  let insightUtxo = {
    address: rpcUtxo.address,
    txid: rpcUtxo.txId,
    vout: rpcUtxo.outputIndex,
    scriptPubKey: rpcUtxo.script,
    amount: amountFloat,
    satoshis: rpcUtxo.satoshis,
    // height: -1,
    // confirmations: -1,
  };

  return insightUtxo;
}

/**
 * @param {MemCoin} memCoin
 * @returns {RpcUtxo}
 */
function memCoinToRpc(memCoin) {
  let rpcUtxo = {
    address: memCoin.address,
    txid: memCoin.txid,
    outputIndex: memCoin.index,
    script: "",
    satoshis: memCoin.satoshis,
    height: -1,
    confirmed: memCoin._confirmed || false,
    pending: !memCoin._confirmed,
  };

  return rpcUtxo;
}

// {BASE_URL}/insight-api/addr/${address}/utxo
app.get("/insight-api/addr/:addresses/utxo", async function (req, res) {
  let addressesStr = req.param.addresses || "";
  addressesStr = addressesStr.trim();

  let addresses = addressesStr.split(/[, ]+/);
  if (!addressesStr) {
    addresses = [];
  }

  let rpcUtxos = await getInstantUtxos(addresses);

  let insightUtxos = [];
  for (let rpcUtxo of rpcUtxos) {
    let insightUtxo = rpcUtxoToInsight(rpcUtxo);
    insightUtxos.push(insightUtxo);
  }

  res.json(insightUtxos);
});

app.get("/api/utxos", async function (req, res) {
  let addressesStr = req.query.addresses || "";
  addressesStr = addressesStr.trim();

  let addresses = addressesStr.split(/[, ]+/);
  if (!addressesStr) {
    addresses = [];
  }

  let rpcUtxos = await getInstantUtxos(addresses);

  res.json(rpcUtxos);
});

app.post("/api/utxos", async function (req, res) {
  let addresses = req.body?.addresses || [];
  // TODO validate address string length

  console.log(`addresses.length: ${addresses.length}`);

  let rpcUtxos = await getInstantUtxos(addresses);

  res.json(rpcUtxos);
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

/**
 * @typedef {Object} InsightUtxo
 * @property {String} address - pay addr (base58check pubkey hash)
 * @property {String} txid - hex tx id
 * @property {Number} vout - output index
 * @property {String} scriptPubKey
 * @property {Number} amount - DASH as a float
 * @property {Number} satoshis
 * @property {Number} height
 * @property {Number} confirmations
 */

/**
 * @typedef {Object} RpcUtxo
 * @property {String} address
 * @property {String} txid
 * @property {Number} outputIndex
 * @property {String} script
 * @property {Number} satoshis
 * @property {Number} height
 * @property {Boolean} [confirmed] - either on block or instantsend-locked
 * @property {Boolean} [pending] - not on block, no instantsend lock on tx
 */

/**
 * @typedef {Object} MemCoin
 * @property {String} address
 * @property {String} txid
 * @property {Number} index - outputIndex, or inputIndex if 'prevout' exists
 * @property {Number} satoshis - negative if 'prevout' exists
 * @property {Number} timestamp - when received
 * @property {String} [prevtxid] - (spent) txid
 * @property {Number} [prevout] - (spent) tx outputIndex
 * @property {Boolean} [_confirmed] - (internal) has matching tx with instantSend lock
 * @property {Boolean} [_pending] - (internal) no instantSend lock on tx
 */
