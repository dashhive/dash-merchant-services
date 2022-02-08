`use strict`;

let Base58Check = module.exports;

let Crypto = require(`crypto`);

Base58Check.checksum = function (parts) {
    let buf = Buffer.from(`${parts.version}${parts.pubKeyHash}`, `hex`);
    let hash1 = Crypto.createHash(`sha256`).update(buf).digest();
    let hash2 = Crypto.createHash(`sha256`).update(hash1).digest(`hex`);
    let check = hash2.slice(0, 8);

    return check;
};

Base58Check.verify = function (base58check) {
    let parts = Base58Check.decode(base58check);
    let check = Base58Check.checksum(parts);

    if (parts.check !== check) {
        throw new Error(`expected '${parts.check}', but got '${check}'`);
    }

    return parts;
};

// decode Base58Check
Base58Check.decode = function (addr) {
    if (50 !== addr.length) {
        throw new Error(
            `pubKeyHash isn't as long as expected (should be 50 chars, not ${addr.length})`
        );
    }

    let version = addr.slice(0, 2);
    if ("4c" !== version) {
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
    let check = Base58Check.checksum(parts);
    return `${parts.version}${parts.pubKeyHash}${check}`;
};

// Test
if (require.main === module) {
    console.info(`Test that it all works as expected...`);
    let addr = `4c 1a2e668007a28dbecb420a8e9ce8cdd1651f213d 6496ad2a`.replace(/\s*/g, '');
    let parts = Base58Check.verify(addr)
    console.info(`\t` + JSON.stringify(parts));

    let full = Base58Check.encode(parts)
    console.info(`\t${full}`);

    if (full !== addr) {
        throw new Error(`expected '${addr}' but got '${full}'`);
    }
    console.info(`PASS`);
}
