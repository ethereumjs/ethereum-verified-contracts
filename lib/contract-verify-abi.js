const assert = require('assert')
const abiCoder = require('ethers').utils.AbiCoder.defaultCoder // Remove this package

function verify (types, data) {
  const data2 = abiCoder.encode(types, abiCoder.decode(types, '0x' + data)).slice(2)
  assert.equal(data2, data)
}

module.exports = {
  verify
}
