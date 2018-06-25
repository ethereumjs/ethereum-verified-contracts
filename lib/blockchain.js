const assert = require('assert')
const fetch = require('node-fetch')
const EthTx = require('ethereumjs-tx')
const ethUtil = require('ethereumjs-util')

// TODO: setup own nodes
const providers = {
  foundation: 'http://localhost:8545/'
  // foundation: 'https://mainnet.infura.io/',
  // kovan: 'https://kovan.infura.io/',
  // rinkeby: 'https://rinkeby.infura.io/',
  // ropsten: 'https://ropsten.infura.io/'
}

const getReqId = (() => {
  let id = 0
  return () => id++
})()

async function getTxInfo (network, txid) {
  const res = await fetch(providers[network], {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: getReqId(),
      method: 'eth_getTransactionByHash',
      params: [txid]
    })
  })
  const { result } = await res.json()

  const tx = new EthTx({
    nonce: result.nonce,
    gasPrice: result.gasPrice,
    gasLimit: result.gas,
    to: result.to,
    value: result.value,
    data: result.input,
    v: result.v,
    r: result.r,
    s: result.s
  })
  assert.equal('0x' + tx.hash().toString('hex'), txid)

  const fromAddress = '0x' + tx.getSenderAddress().toString('hex')
  const nonce = ethUtil.bufferToInt(tx.nonce)
  const hash = ethUtil.rlphash([fromAddress, nonce])
  const address = '0x' + hash.slice(-20).toString('hex')
  return { address, bin: tx.data.toString('hex') }
}

module.exports = {
  getTxInfo
}