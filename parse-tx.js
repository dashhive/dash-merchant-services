#!/usr/bin/env node
"use strict";

//let Tx = require("../dashtx.js");
let Tx = require("dashtx");
module.export = Tx;

//let DashKeys = require("dashkeys");

Tx.parse = async function (hex) {
  // This is a rare exception where breaking this down further
  // to reduce the number of statements would not decrease the
  // complexity or increase clarity or make it more debuggable.
  // HOWEVER, if we support more input and output types, those
  // parsers should be pulled into separate places.
  /* jshint maxstatements: 400 */
  let tx = {
    txId: "",
    version: 0,
    inputs: [],
    outputs: [],
    locktime: 0,
    //satoshisIn: 0,
    satoshisOut: 0,
    //fee: 0,
  };

  let hasInputScript = false;

  hex = hex.trim();

  let next = 0;
  let versionHex = hex.substr(next, 8);
  next += 8;

  // TODO reverse
  let versionByteHex = versionHex.substr(0, 2);
  tx.version = parseInt(versionByteHex, 16);

  // console.info();
  // console.info();
  // console.info(`${versionHex}                  # VERSION (${tx.version})`);

  let numInputsHex = hex.substr(next, 2);
  let numInputs = parseInt(numInputsHex, 16);
  next += 2;

  if (numInputs > 252) {
    if (253 === numInputs) {
      numInputsHex += hex.substr(next, 4);
    } else if (254 === numInputs) {
      numInputsHex += hex.substr(next, 8);
    } else if (255 === numInputs) {
      numInputsHex += hex.substr(next, 16);
    }
    numInputs = parseInt(numInputsHex, 16);
    next += numInputsHex.length - 2;
  }
  // console.info(
  //   `${numInputsHex}                        # Inputs (${numInputs})`
  // );

  for (let i = 0; i < numInputs; i += 1) {
    let input = {
      txId: "",
      satoshis: 0,
      outputIndex: 0,
      script: "",
      signature: "",
      sigHashType: 0,
      publicKey: "",
      sequence: "",
    };

    // let count = i + 1;
    // console.info();
    // console.info(`# Input ${count} of ${numInputs}`);

    input.txId = hex.substr(next, 64);
    next += 64;
    // console.info("   ", input.txId.slice(0, 16), "     # Previous Output TX ID");
    // console.info("   ", input.txId.slice(16, 32));
    // console.info("   ", input.txId.slice(32, 48));
    // console.info("   ", input.txId.slice(48, 64));

    let outputIndexHex = hex.substr(next, 8);
    let outputIndexByteHex = outputIndexHex.slice(0, 2);
    let outputIndex = parseInt(outputIndexByteHex, 16);
    next += 8;
    input.outputIndex = outputIndex;
    // console.info(
    //   `    ${outputIndexHex}              # Previous Output index (${input.outputIndex})`
    // );

    // TODO VarInt
    let scriptSizeHex = hex.substr(next, 2);
    let scriptSize = parseInt(scriptSizeHex, 16);
    next += 2;
    // console.info(
    //   `    ${scriptSizeHex}                    # Script Size (${scriptSize} bytes)`
    // );

    if (0 === scriptSize) {
      // "Raw" Tx
      throw new Error("unsigned raw tx");
    } else if (25 === scriptSize) {
      throw new Error("unsigned hashable tx");

      // // "Hashable" Tx
      // hasInputScript = true;

      // let script = hex.substr(next, 2 * scriptSize);
      // next += 2 * scriptSize;

      // console.info(
      //   "   ",
      //   script.slice(0, 4),
      //   "                 # (Hashable) Lock Script"
      // );
      // console.info("   ", script.slice(4, 6));
      // console.info("   ", script.slice(6, 26));
      // console.info("   ", script.slice(26, 46));
      // console.info("   ", script.slice(46, 50));
    } else if (scriptSize >= 106 && scriptSize <= 109) {
      hasInputScript = true;

      input.script = hex.substr(next, 2 * scriptSize);
      next += 2 * scriptSize;

      // let sigSizeHex = input.script.substr(0, 2);
      // let sigSize = parseInt(sigSizeHex, 16);
      // console.info(
      //   `    ${sigSizeHex}                    # Signature Script Size (${sigSize})`
      // );

      let asn1Seq = input.script.substr(2, 2);
      let asn1Bytes = input.script.substr(4, 6);
      // console.info(
      //   `    ${asn1Seq}${asn1Bytes}                  # ASN.1 ECDSA Signature`
      // );

      let rTypeHex = input.script.substr(6, 2);
      let rSizeHex = input.script.substr(8, 2);
      let rSize = parseInt(rSizeHex, 16);
      // console.info(`    ${rTypeHex}${rSizeHex}`);

      let sIndex = 10;
      let rValue = input.script.substr(sIndex, 2 * rSize);
      sIndex += 2 * rSize;
      // let rValuePad = rValue.padStart(66, " ");
      // console.info(`    ${rValuePad}`);

      let sTypeHex = input.script.substr(sIndex, 2);
      sIndex += 2;

      let sSizeHex = input.script.substr(sIndex, 2);
      let sSize = parseInt(sSizeHex, 16);
      sIndex += 2;
      // console.info(`    ${sTypeHex}${sSizeHex}`);

      let sValue = input.script.substr(sIndex, 2 * sSize);
      sIndex += 2 * sSize;
      // let sValuePad = sValue.padStart(66, " ");
      // console.info(`    ${sValuePad}`);

      input.signature = `${asn1Seq}${asn1Bytes}${rTypeHex}${rSizeHex}${rValue}${sTypeHex}${sSizeHex}${sValue}`;

      let sigHashTypeHex = input.script.substr(sIndex, 2);
      input.sigHashType = parseInt(sigHashTypeHex, 16);
      sIndex += 2;
      // console.info(
      //   `    ${sigHashTypeHex}                    # Sig Hash Type (${input.sigHashType})`
      // );

      let publicKeySizeHex = input.script.substr(sIndex, 2);
      let publicKeySize = parseInt(publicKeySizeHex, 16);
      sIndex += 2;
      // console.info(
      //   `    ${publicKeySizeHex}                    # Public Key Size (${publicKeySize})`
      // );

      let publicKeyHex = input.script.substr(sIndex, 2 * publicKeySize);
      sIndex += 2 * publicKeySize;
      input.publicKey = publicKeyHex;
      // console.info(`    ${input.publicKeyHex}`);

      let rest = input.script.substr(sIndex);
      if (rest) {
        console.error("spurious extra in script???");
        console.error(rest);
      }

      // "Signed" Tx
    } else {
      throw new Error(
        `expected a "script" size of 0 (raw), 25 (hashable), or 106-109 (signed), but got '${scriptSize}'`
      );
    }

    input.sequence = hex.substr(next, 8);
    next += 8;

    // console.info(`    ${input.sequence}              # Sequence (always 0xffffffff)`);

    tx.inputs.push(input);
    //tx.satoshisIn += input.satoshis;
  }

  let numOutputsHex = hex.substr(next, 2);
  // TODO varint
  let numOutputs = parseInt(numOutputsHex, 16);
  next += 2;
  // console.info();
  // console.info(
  //   `${numOutputsHex}                        # Outputs (${numOutputs})`
  // );

  for (let i = 0; i < numOutputs; i += 1) {
    let output = {
      satoshis: 0,
    };

    // let count = i + 1;
    // console.info(`# Output ${count} of ${numOutputs}`);

    let satsHexReverse = hex.substr(next, 16);
    next += 16;
    let satsHex = Tx.utils.reverseHex(satsHexReverse);
    output.satoshis = parseInt(satsHex, 16);
    tx.satoshisOut += output.satoshis;

    // console.info(
    //   `    ${satsHexReverse}      # Base Units (satoshis) (${output.satoshis})`
    // );

    // TODO VarInt
    let lockScriptSizeHex = hex.substr(next, 2);
    let lockScriptSize = parseInt(lockScriptSizeHex, 16);
    // console.info(
    //   `    ${lockScriptSizeHex}                    # Lock Script Size (${lockScriptSize} bytes)`
    // );
    next += 2;

    output.script = hex.substr(next, 2 * lockScriptSize);
    next += 2 * lockScriptSize;

    // console.info("   ", output.script.slice(0, 4), "                 # Script");
    // console.info("   ", output.script.slice(4, 6));
    let pkhHex = output.script.slice(6, 46);
    output.pubKeyHash = pkhHex;
    //let pkhBytes = DashKeys.utils.hexToBytes(pkhHex);
    //output.address = await DashKeys.pkhToAddr(pkhBytes);
    // console.info(
    //   "   ",
    //   output.script.slice(6, 26),
    //   `  # ${output.address}`
    // );
    // console.info("   ", output.script.slice(26, 46));
    // console.info("   ", output.script.slice(46, 50));
    // console.info();

    tx.outputs.push(output);
  }

  // TODO reverse
  let locktimeHex = hex.substr(next, 8);
  locktimeHex = Tx.utils.reverseHex(locktimeHex);
  tx.locktime = parseInt(locktimeHex, 16);
  next += 8;
  // console.info(`${locktimeHex}                  # LOCKTIME (${tx.locktime})`);
  // console.info();

  let sigHashTypeHex = hex.substr(next);
  if (sigHashTypeHex) {
    tx.sigHashType = parseInt(sigHashTypeHex.slice(0, 2));
    hex = hex.slice(0, -8);
    // console.info(
    //   `${sigHashTypeHex}                  # SIGHASH_TYPE (0x${tx.sigHashType})`
    // );
    // console.info();

    // let txHash = await Tx.hashPartial(hex);
    // let txHashHex = Tx.utils.u8ToHex(txHash);
    // // TODO 'N/A' if not applicable
    // console.info(`Tx Hash: ${txHashHex}`);
    // console.info(`TxID:   N/A`);
  } else if (hasInputScript) {
    // console.info(`Tx Hash: N/A`);
    tx.txId = await Tx.getId(hex);
    // console.info(`TxID: ${tx.txId}`);
  } else {
    // console.info(`Tx Hash: N/A`);
    // console.info(`TxID:   N/A`);
  }

  let txBytes = hex.length / 2;
  // console.info(`Tx Bytes:       ${txBytes}`);
  // console.info();
  // console.info(`Tx Outputs:     ${tx.satoshisOut}`);
  // console.info(`Tx Fee:         ${txBytes}`);
  // let txCost = txBytes + tx.satoshisOut;
  // console.info(`Tx Min Cost:    ${txCost}`);
  // console.info();

  tx.size = txBytes;
  //tx.fee = tx.satoshisIn - tx.satoshisOut;

  return tx;
};

module.exports = Tx;

if (require.main === module) {
  let Fs = require("node:fs");

  let filepath = process.argv[2];
  let hex = Fs.readFileSync(filepath, "utf8");

  Tx.parse(hex).catch(function (err) {
    console.error("Fail:");
    console.error(err.stack || err);
    process.exit(1);
  });
}
