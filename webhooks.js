"use strict";

let Base58Check = require("./base58check.js");
let request = require("./lib/request.js");

let Hooks = module.exports;

Hooks.create = function ({ defaultWebhookTimeout, Db }) {
  let hooks = {};
  hooks.register = async function (req, res) {
    let data = {
      url: req.body.url,
      address: req.body.address,
    };
    let webhookUrl = req.body.url;
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
      pubKeyHash: addr,
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

  return hooks;
};
