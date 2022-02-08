"use strict";

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

// https://github.com/dashevo/dashcore-node/blob/master/docs/services/dashd.md
// https://github.com/dashevo/dashcore-node/blob/master/README.md

let Path = require("path");

let Script = require("./script.js");

let dashcore = require("@dashevo/dashcore-node");
let config = require(Path.resolve(process.env.DASH_CONFIG));

let node = dashcore.scaffold.start({
  path: process.env.DASH_PATH,
  config: config,
});

let interestings = {};
function isInteresting(p2pkh) {
  if (true || interestings[p2pkh]) {
    // TODO check webhook info
    return true;
  }
}

node.on("ready", function () {
  node.services.dashd.on("tx", function (txData) {
    // a new transaction has entered the mempool
    //console.log("txData", txData);
    let tx = new dashcore.lib.Transaction(txData);
    //let json = JSON.stringify(tx, null, 2);
    //console.log("tx:", json);

    tx.outputs.some(function (output) {
      let out = output.toJSON();

      let p2pkh;
      try {
        p2pkh = Script.parsePubKeyHash(out.script.toString());
      } catch (e) {
        return;
      }

      if (isInteresting(p2pkh)) {
        console.info(`${out.satoshis} => ${p2pkh}`);
      }
    });

    // TODO calc the fee just for fun
    // fee = sum(inputs) - sum(outputs)
  });
});

// TODO
// Register an address and a webhook
// Fire webhooks when a transaction with a matching address comes in
