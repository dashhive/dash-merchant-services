"use strict";

let HooksDb = module.exports;

let defaultStaleAge = 15 * 60 * 1000;
HooksDb.create = function ({ staleAge }) {
  if (!staleAge) {
    staleAge = defaultStaleAge;
  }

  let hooksDb = {};
  let registeredAddresses = {};
  hooksDb.getByPubKeyHash = async function (p2pkh) {
    return registeredAddresses[p2pkh];
  };

  hooksDb.all = async function () {
    return registeredAddresses;
  };

  hooksDb.set = async function (hook) {
    // XXX BUG TODO
    // Note: we can only have one webhook per address this way:
    registeredAddresses[hook.pubKeyHash] = hook;
  };

  hooksDb.cleanup = async function () {
    let freshtime = Date.now() - staleAge;
    Object.keys(registeredAddresses).forEach(function (key) {
      if (registeredAddresses[key].ts > freshtime) {
        return;
      }
      console.log("[DEBUG] delete", registeredAddresses[key]);
      delete registeredAddresses[key];
    });
  };
  return hooksDb;
};
