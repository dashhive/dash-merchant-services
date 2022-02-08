`use strict`;

// Solves the problem of finding the address to which some satoshis were sent
// https://stackoverflow.com/questions/50456055/why-does-bitcore-lib-not-decode-my-bitcoin-transaction-hex-correctly

// https://dashcore.readme.io/docs/core-ref-transactions-opcodes
const OP_DUP = (0x76).toString(16);
const OP_HASH160 = (0xa9).toString(16);
const HASH_LEN = (20).toString(16);
const OP_EQUALVERIFY = (0x88).toString(16);
const OP_CHECKSIG = (0xac).toString(16);

let Script = module.exports;

// Found at tx.outputs[].{satoshis, script}
// See https://dashcore.readme.io/docs/core-api-ref-remote-procedure-calls-raw-transactions#decoderawtransaction
Script.parsePubKeyHash = function (script) {
  // Ex: 76 a9 14 1b726ddc41f9ebc65d11b674d435fa244bea5296 88 ac
  let opDup = script.slice(0, 2);
  let opHash = script.slice(2, 4);
  let len = script.slice(4, 6);
  let p2pkh = script.slice(6, -4);
  let opEqVer = script.slice(-4, -2);
  let opChecksig = script.slice(-2);

  if (OP_DUP !== opDup) {
    throw new Error(`bad script: expected '${OP_DUP}' but got '${opDup}'`);
  }
  if (OP_HASH160 !== opHash) {
    throw new Error(`bad script: expected '${OP_HASH160}' but got '${opHash}'`);
  }
  if (HASH_LEN !== len) {
    throw new Error(`bad script: expected '${HASH_LEN}' but got '${len}'`);
  }
  if (OP_EQUALVERIFY !== opEqVer) {
    throw new Error(
      `bad script: expected '${OP_EQUALVERIFY}' but got '${opEqVer}'`
    );
  }
  if (OP_CHECKSIG !== opChecksig) {
    throw new Error(`bad script: expected '${OP_HASH160}' but got '${opHash}'`);
  }

  // pub key hash
  return p2pkh;
};

// Test
if (require.main === module) {
  // Example Tx with Script:
  // (click "view raw")
  // https://blockchair.com/dash/transaction/4c65e3f6e985270b4111175f81112aafc6007c9c90e75b3a65b939e406bcd2de

  console.info(`Test that it all works as expected...`);
  let pubKeyHash = "1a2e668007a28dbecb420a8e9ce8cdd1651f213d";
  let script =
    `${OP_DUP} ${OP_HASH160} ${HASH_LEN} ${pubKeyHash} ${OP_EQUALVERIFY} ${OP_CHECKSIG}`.replace(
      /\s*/g,
      ""
    );
  let out = Script.parsePubKeyHash(script);
  console.info(`\t${out}`);

  if (pubKeyHash !== out) {
    throw new Error(`expected '${pubKeyHash}' but got '${out}'`);
  }
  console.info(`PASS`);
}
