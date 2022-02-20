"use strict";

let TokenGenerator = module.exports;

let Crypto = require("crypto");
var Base62Token = require("base62-token");
var dict = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var b62Token = Base62Token.create(dict);

function toWeb64(b) {
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

TokenGenerator.create = function (n) {
  //let b64 = Crypto.randomBytes(n).toString("base64");
  //return toWeb64(b64);
  var token = b62Token.generate("dwh_", 30);
  return token;
};

TokenGenerator.hash = function (val, n) {
  let h = Crypto.createHash("sha256").update(val).digest("base64");
  return toWeb64(h).slice(0, n);
};

/*
TokenGenerator.checksum = function (token) {
  var checksum = b62Token.verify(token);
  return checksum;
};
*/
