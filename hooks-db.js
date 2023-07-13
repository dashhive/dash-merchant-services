"use strict";

let HooksDb = module.exports;

let ULID = require("ulid");

let defaultStaleAge = 15 * 60 * 1000;
HooksDb.create = function ({ staleAge }) {
  if (!staleAge) {
    staleAge = defaultStaleAge;
  }

  let db = {
    _registeredHooks: {},
    _registeredPkhs: {},
    _staleAge: staleAge,
  };

  db.getByPkhs = async function (pkhs) {
    let hooksMap = {};

    for (let pkh of pkhs) {
      let ulids = db._registeredPkhs[pkh]?.hookUlids;
      if (!ulids?.length) {
        continue;
      }

      for (let ulid of ulids) {
        let hook = db._registeredHooks[ulid];
        hooksMap[ulid] = hook;
      }
    }

    let hooks = Object.values(hooksMap);
    return hooks;
  };

  // db.all = async function () {
  //   return db._registeredPkhs;
  // };

  db.set = async function (hook, pkhs) {
    let ulid = hook.ulid || ULID.ulid();
    let now = hook.now || Date.now();
    db._registeredHooks[ulid] = hook;

    for (let pkh of pkhs) {
      await db._setPkh(ulid, pkh, now);
    }
  };

  db._setPkh = async function (ulid, pubKeyHash, now) {
    if (!db._registeredPkhs[pubKeyHash]) {
      db._registeredPkhs[pubKeyHash] = { ts: 0, hookUlids: [] };
    }
    db._registeredPkhs[pubKeyHash].ts = now;
    db._registeredPkhs[pubKeyHash].hookUlids.push(ulid);
  };

  db.cleanup = async function () {
    let freshtime = Date.now() - db._staleAge;

    let pkhs = Object.keys(db._registeredPkhs);
    for (let pkh of pkhs) {
      if (db._registeredPkhs[pkh].ts > freshtime) {
        return;
      }

      console.log("[DEBUG] delete pubKeyHash", db._registeredPkhs[pkh]);
      delete db._registeredPkhs[pkh];
    }

    let ulids = Object.keys(db._registeredHooks);
    for (let ulid of ulids) {
      if (db._registeredHooks[ulid].ts > freshtime) {
        return;
      }

      console.log("[DEBUG] delete hook", db._registeredHooks[ulid]);
      delete db._registeredHooks[ulid];
    }
  };

  return db;
};
