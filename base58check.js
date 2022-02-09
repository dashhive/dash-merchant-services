"use strict";

// See also:
// - https://en.bitcoin.it/wiki/Base58Check_encoding
// - https://appdevtools.com/base58-encoder-decoder

let Base58Check = module.exports;

let Crypto = require(`crypto`);

var BASE58 = `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`;
var bs58 = require(`base-x`)(BASE58);

Base58Check.checksum = function (parts) {
  let buf = Buffer.from(`${parts.version}${parts.pubKeyHash}`, `hex`);
  let hash1 = Crypto.createHash(`sha256`).update(buf).digest();
  let hash2 = Crypto.createHash(`sha256`).update(hash1).digest(`hex`);
  let check = hash2.slice(0, 8);

  return check;
};

Base58Check.verify = function (b58Addr) {
  let buf = bs58.decode(b58Addr);
  let hex = buf.toString(`hex`);
  return Base58Check.verifyHex(hex);
};

Base58Check.verifyHex = function (base58check) {
  let parts = Base58Check.decodeHex(base58check);
  let check = Base58Check.checksum(parts);

  if (parts.check !== check) {
    throw new Error(`expected '${parts.check}', but got '${check}'`);
  }

  return parts;
};

Base58Check.decode = function (b58Addr) {
  let buf = bs58.decode(b58Addr);
  let hex = buf.toString(`hex`);
  return Base58Check.decodeHex(hex);
};

// decode Base58Check
Base58Check.decodeHex = function (addr) {
  if (50 !== addr.length) {
    throw new Error(
      `pubKeyHash isn't as long as expected (should be 50 chars, not ${addr.length})`
    );
  }

  let version = addr.slice(0, 2);
  if (`4c` !== version) {
    throw new Error(
      `expected Dash pubKeyHash to start with 0x42, not '0x${version}'`
    );
  }

  let rawAddr = addr.slice(2, -8);
  return {
    version,
    pubKeyHash: rawAddr,
    check: addr.slice(-8),
  };
};

Base58Check.encode = function (parts) {
  let hex = Base58Check.encodeHex(parts);
  let buf = Buffer.from(hex, `hex`);
  return bs58.encode(buf);
};

Base58Check.encodeHex = function (parts) {
  let check = Base58Check.checksum(parts);
  return `${parts.version}${parts.pubKeyHash}${check}`;
};

// Test
if (require.main === module) {
  console.info(`Test that it all works as expected...`);
  let reference = `Xd5GzCN6mp77BeVEe6FrgqQt8MA1ge4Fsw`;
  let hex = `4c 1a2e668007a28dbecb420a8e9ce8cdd1651f213d 6496ad2a`;
  hex = hex.replace(/\s*/g, ``);

  let bufAddr = Buffer.from(hex, `hex`);
  let addr = bs58.encode(bufAddr);
  if (addr !== reference) {
    throw new Error(
      "[SANITY FAIL] the universe no longer obeys the law of base58"
    );
  }

  let parts = Base58Check.verify(addr);
  console.info(`\t` + JSON.stringify(parts));

  let full = Base58Check.encode(parts);
  console.info(`\t${full}`);

  if (full !== addr) {
    throw new Error(`expected '${addr}' but got '${full}'`);
  }
  console.info(`PASS`);
}
