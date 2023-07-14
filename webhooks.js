"use strict";

let Hooks = module.exports;

let request = require("./lib/request.js");
let DashKeys = require("dashkeys");

Hooks.create = function ({ defaultWebhookTimeout = 5 * 1000, Db }) {
  let hooks = {};

  hooks.register = async function (req, res) {
    let data = {
      url: req.body.url,
      addresses: req.body.addresses,
    };
    if (!data.addresses) {
      data.addresses = [req.body.address];
    }

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

    let addrInfos = [];
    for (let address of data.addresses) {
      try {
        let addrInfo = await DashKeys.decode(address, { validate: true });
        addrInfos.push(addrInfo);
      } catch (e) {
        throw new Error("BAD_REQUEST: could not decode Dash address");
      }
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
        addresses: data.addresses,
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

    let now = Date.now();
    let pkhs = [];
    for (let addrInfo of addrInfos) {
      pkhs.push(addrInfo.pubKeyHash);
    }
    let hook = {
      ts: now,
      _pubKeyHashes: pkhs,
      username: url.username,
      password: url.password,
      url: data.url,
    };
    await Db.set(hook, pkhs);

    // address: data.address,
    // pubKeyHash: addrInfo.pubKeyHash,
    //let all = await Db.all();
    //console.log("DEBUG", addrInfo.pubKeyHash, all);

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
  hooks.send = async function (event, txInfo, pubKeyHashes) {
    let evname = event;

    let _hooks = await Db.getByPkhs(pubKeyHashes);
    if (!_hooks?.length) {
      return;
    }

    // payaddr,
    // { event, txid, satoshis, pubKeyHash }
    for (let hook of _hooks) {
      let pubKeyHashes = [];
      let addresses = [];
      let satoshis = 0;
      // TODO submitting a duplicate pkh results in incorrect calculation
      for (let pkh of hook.pubKeyHashes) {
        for (let output of txInfo.outputs) {
          if (pkh !== output.pubKeyHash) {
            continue;
          }
          let address = await DashKeys.encode(pkh);
          addresses.push(address);
          pubKeyHashes.push(pkh);
          satoshis += output.satoshis;
        }
      }
      console.info(`[${evname}] Target: ${satoshis} => ${hook.nonce}`);

      let data = {
        event: evname,
        transaction: txInfo,
        instantsend: ["txlock", "rawtxlock"].includes(event),
        pubKeyHashes: hook.address,
        satoshis: satoshis,
      };
      let req = {
        timeout: defaultWebhookTimeout,
        auth: {
          username: hook.username,
          password: hook.password,
        },
        url: hook.url,
        json: data,
      };
      await request(req).then(onResp);
    }

    function onResp(resp) {
      if (resp.ok) {
        return resp;
      }

      console.error(`[${evname}] not OK:`);
      console.error(resp.toJSON());
      throw new Error("bad response from webhook");
    }
  };

  return hooks;
};
