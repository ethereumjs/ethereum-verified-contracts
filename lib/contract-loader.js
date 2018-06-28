const assert = require('assert')
const fs = require('fs-extra')
const path = require('path')
const klaw = require('klaw')
const yaml = require('js-yaml')
const eip155 = require('./eip155')

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts')

function getId (info) {
  const chainId = eip155.getChainId(info.network)
  assert.ok(chainId !== undefined, `Unknow network: ${info.network}`)
  return `${info.address}-${chainId}`
}

async function exists (id) {
  try {
    await fs.stat(path.join(CONTRACTS_DIR, id))
    return true
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  return false
}

async function existsByAddressNetwork (address, network) {
  return exists(getId({ address, network }))
}

async function load (id) {
  return new Promise((resolve, reject) => {
    const data = { id, src: {} }

    const dir = path.join(CONTRACTS_DIR, id)
    const read = (name) => fs.readFile(path.join(dir, name), 'utf8').catch(reject)
    const promises = [
      read('abi.json').then((content) => { data.abi = content.trim() }),
      read('bytecode.bin').then((content) => { data.bin = content.trim() }),
      read('info.yaml').then((content) => {
        data.info = yaml.safeLoad(content)
        assert.equal(getId(data.info), id, `Contract id ${id} is wrong, expected: ${getId(data.info)}`)
      })
    ]

    klaw(path.join(dir, 'src'))
      .on('error', reject)
      .on('data', (item) => {
        if (!item.stats.isFile()) return

        const resolve = (content) => { data.src[item.path.slice(dir.length + 5)] = content.trim() }
        promises.push(fs.readFile(item.path, 'utf8').then(resolve, reject))
      })
      .on('end', () => Promise.all(promises).then(() => resolve(data)))
  })
}

async function loadAll (filter = () => true) {
  const lst = await fs.readdir(CONTRACTS_DIR)
  const contracts = []
  await Promise.all(lst.map(async (id) => {
    const contract = await load(id)
    if (filter(contract)) contracts.push(contract)
  }))
  return contracts
}

async function save (contract) {
  // return console.log(require('util').inspect(contract, { depth: null }))
  const id = getId(contract.info)
  if (await exists(id)) return false

  const infoObj = Object.keys(contract.info).reduce((obj, key) => {
    if (contract.info[key]) obj[key] = contract.info[key]
    return obj
  }, {})

  function getPath () { return path.join(CONTRACTS_DIR, id, ...arguments) }
  await Promise.all([
    fs.outputFile(getPath('abi.json'), contract.abi + '\n', 'utf8'),
    fs.outputFile(getPath('bytecode.bin'), contract.bin + '\n', 'utf8'),
    fs.outputFile(getPath('info.yaml'), yaml.safeDump(infoObj), 'utf8'),
    ...Object.entries(contract.src).map(([name, content]) => {
      return fs.outputFile(getPath('src', name), content + '\n', 'utf8')
    })
  ])
  return true
}

module.exports = {
  exists,
  existsByAddressNetwork,
  load,
  loadAll,
  save
}
