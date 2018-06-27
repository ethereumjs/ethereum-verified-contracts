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

async function makeReq (network, method, params) {
  const res = await fetch(providers[network], {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: getReqId(), method, params })
  })
  const json = await res.json()
  if (json.error) assert.fail(json.error.message)
  return json.result
}

const getTxByHash = (network, txid) => makeReq(network, 'eth_getTransactionByHash', [txid])
const getTxTrace = (network, txid) => makeReq(network, 'trace_transaction', [txid])

async function getTxInfo (network, creationTxId) {
  const [txid, traceAddress] = creationTxId.split(':')
  const [txInfo, txTrace] = await Promise.all([
    getTxByHash(network, txid),
    getTxTrace(network, txid)
  ])

  const tx = new EthTx({
    nonce: txInfo.nonce,
    gasPrice: txInfo.gasPrice,
    gasLimit: txInfo.gas,
    to: txInfo.to,
    value: txInfo.value,
    data: txInfo.input,
    v: txInfo.v,
    r: txInfo.r,
    s: txInfo.s
  })
  assert.equal('0x' + tx.hash().toString('hex'), txid)

  let address, bin
  if (traceAddress) {
    const row = txTrace.find((row) => row.traceAddress.join('.') === traceAddress)
    assert.ok(row)
    assert.equal(row.type, 'create')

    address = row.result.address
    bin = row.action.init.slice(2)
  } else {
    const fromAddress = '0x' + tx.getSenderAddress().toString('hex')
    const nonce = ethUtil.bufferToInt(tx.nonce)
    const hash = ethUtil.rlphash([fromAddress, nonce])
    address = '0x' + hash.slice(-20).toString('hex')
    bin = tx.data.toString('hex')

    assert.equal(tx.to.length, 0)
    assert.equal(txTrace[0].type, 'create')
    assert.equal(txTrace[0].action.init.slice(2), bin)
  }

  return { address, bin }
}

module.exports = {
  getTxInfo
}
