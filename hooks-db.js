"use strict";

let HooksDb = module.exports;

let defaultStaleAge = 15 * 60 * 1000;
HooksDb.create = function ({ staleAge }) {
  if (!staleAge) {
    staleAge = defaultStaleAge;
  }

  let db = {
    _registeredAddresses: {},
    _staleAge: staleAge,
  };

  db.getByPubKeyHash = async function (p2pkh) {
    return db._registeredAddresses[p2pkh];
  };

  db.all = async function () {
    return db._registeredAddresses;
  };

  db.set = async function (hook) {
    if (!db._registeredAddresses[hook.pubKeyHash]) {
      db._registeredAddresses[hook.pubKeyHash] = [];
    }

    db._registeredAddresses[hook.pubKeyHash].push(hook);
  };

  db.cleanup = async function () {
    let freshtime = Date.now() - db._staleAge;
    let keys = Object.keys(db._registeredAddresses);
    keys.forEach(function (key) {
      if (db._registeredAddresses[key].ts > freshtime) {
        return;
      }
      console.log("[DEBUG] delete", db._registeredAddresses[key]);
      delete db._registeredAddresses[key];
    });
  };

  return db;
};
