#!/usr/bin/env node

"use strict";

let gentoken = require("../lib/gentoken.js");

function help() {
  console.error(`Usage:`);
  console.error(`    node ./bin/gentoken.js <allowed-hostnames>`);
  console.error(`Example:`);
  console.error(`    node ./bin/gentoken.js example.com,example.net`);
}

function main() {
  let hostnames = (process.argv[2] ?? "").split(/[, ]+/).filter(Boolean);
  if (!hostnames.length) {
    help();
    process.exit(1);
    return;
  }

  let token = gentoken.create(16);
  let h = gentoken.hash(token, 24);
  let hostnamesJson = JSON.stringify(hostnames);
  console.info(`"${h}": { "token": "${token}", hostnames: ${hostnamesJson} },`);
}

main();
