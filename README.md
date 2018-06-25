# Ethereum Verified Contracts

## Verification

Download solidity binaries:

```
git clone https://github.com/ethereum/solc-bin.git
mkdir .soljson
mv ./solc-bin/soljson-v* ./.soljson
rm -rf ./solc-bin
```

Verify contracts:

```
node ./bin/verify.js
```

## LICENSE

MIT license.
