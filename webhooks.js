"use strict";

let request = require("./lib/request.js");
let Base58Check = require("@root/base58check").Base58Check;

let b58c = Base58Check.create();

let Hooks = module.exports;

Hooks.create = function ({ defaultWebhookTimeout = 5 * 1000, Db }) {
  let hooks = {};

  hooks.register = async function (req, res) {
    let data = {
      url: req.body.url,
      address: req.body.address,
    };
    let webhookUrl = req.body.url;
    // TODO
    let account = req.account;

    let url;
    try {
      url = new URL(data.url);
    } catch (e) {
      throw new Error(`BAD_REQUEST: invalid webhook url '${data.url}'`);
    }
    // TODO
    if (!account.hostnames.includes(url.hostname)) {
      throw new Error(`BAD_REQUEST: untrusted hostname '${url.hostname}'`);
    }
    if ("https:" !== url.protocol) {
      throw new Error(`BAD_REQUEST: insecure webhook url '${url.protocol}'`);
    }

    let addr;
    try {
      addr = await b58c.verify(data.address);
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
      url: webhookUrl,
      json: { address: data.address, satoshis: 0 },
    }).then(function (resp) {
      if (resp.ok) {
        throw new Error(
          "BAD_REQUEST: unauthenticated webhook test did not fail"
        );
      }
    });

    await Db.set({
      ts: Date.now(),
      address: data.address,
      pubKeyHash: addr.pubKeyHash,
      username: url.username,
      password: url.password,
      url: data.url,
    });
    let all = await Db.all();
    console.log("DEBUG", addr.pubKeyHash, all);

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
    await Db.cleanup();
  };

  //let msg = { event: evname, txid: tx.hash, satoshis: out.satoshis };
  hooks.send = async function (payaddr, { event, txid, satoshis, p2pkh }) {
    let hook;
    if (p2pkh) {
      hook = await Db.getByPubKeyHash(p2pkh);
    } else {
      hook = await Db.get(payaddr);
    }
    if (!hook) {
      return;
    }

    let evname = event;
    let out = {
      satoshis: satoshis,
    };
    let tx = {
      hash: txid,
    };

    console.info(`[${evname}] Target: ${out.satoshis} => ${payaddr}`);
    //console.log("DEBUG", payaddr, { event, txid, satoshis, p2pkh });
    //console.log("DEBUG hook", hook);
    let req = {
      timeout: defaultWebhookTimeout,
      auth: {
        username: hook.username,
        password: hook.password,
      },
      url: hook.url,
      json: {
        txid: tx.hash,
        event: evname,
        instantsend: "txlock" === event,
        address: hook.address,
        // TODO duffs
        satoshis: out.satoshis,
      },
    };

    await request(req).then(function (resp) {
      if (resp.ok) {
        return resp;
      }

      console.error(`[${evname}] not OK:`);
      console.error(resp.toJSON());
      throw new Error("bad response from webhook");
    });
  };

  return hooks;
};
