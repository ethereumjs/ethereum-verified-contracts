// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md#list-of-chain-ids
const EIP155 = [
  { chain: 'foundation', ids: [1, 0] },
  { chain: 'morden', ids: [2] },
  { chain: 'ropsten', ids: [3] },
  { chain: 'rinkeby', ids: [4] },
  { chain: 'rootstock', ids: [30] },
  { chain: 'rootstock testnet', ids: [31] },
  { chain: 'kovan', ids: [42] },
  { chain: 'classic', ids: [61] },
  { chain: 'classic testnet', ids: [62] }
]

const getChainId = (() => {
  const obj = {}
  for (const row of EIP155) obj[row.chain] = row.ids[0]

  return (network) => obj[network]
})()

const getNetwork = (() => {
  const obj = {}
  for (const row of EIP155) {
    for (const id of row.ids) obj[id] = row.chain
  }

  return (id) => obj[id]
})()

module.exports = {
  getChainId,
  getNetwork
}
