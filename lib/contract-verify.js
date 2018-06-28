const assert = require('assert')
const blockchain = require('./blockchain')
const contractCompile = require('./contract-compile')
const contractVerifyABI = require('./contract-verify-abi')

function verifyConstructorArguments (contract) {
  if (!contract.info.constructor) return

  const abi = JSON.parse(contract.abi).find((item) => item.type === 'constructor')
  const types = abi.inputs.map((item) => item.type)
  contractVerifyABI.verify(types, contract.info.constructor)
}

async function verifySource (contract, getSolc) {
  const solc = await getSolc(contract.info.compiler)
  const compiled = contractCompile.compile(solc, {
    src: contract.src,
    ...contract.info
  })
  assert.equal(contract.abi, compiled.abi)
  assert.equal(contract.bin, compiled.bin + contract.info.constructor)
  return compiled.warnings
}

async function verifyTx (contract) {
  const txInfo = await blockchain.getTxInfo(contract.info.network, contract.info.txid)
  assert.equal(contract.info.address, txInfo.address)
  assert.equal(contract.bin, txInfo.bin)
}

async function verify (contract, getSolc) {
  const [, warnings] = await Promise.all([
    verifyConstructorArguments(contract),
    verifySource(contract, getSolc),
    verifyTx(contract)
  ])
  return warnings
}

module.exports = {
  verify
}
