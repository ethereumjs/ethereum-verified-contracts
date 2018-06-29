const assert = require('assert')
const yargs = require('yargs')
const makeConcurrent = require('make-concurrent')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const logSymbols = require('log-symbols')
const semver = require('semver')
const linker = require('solc/linker')
const blockchain = require('../lib/blockchain')
const contractLoader = require('../lib/contract-loader')
const compilersMap = require('../lib/compilers-map')
const etherscanSkip = require('../lib/etherscan-skip')

function getArgs () {
  return yargs
    .usage('Usage: $0 [options]')
    .wrap(yargs.terminalWidth())
    .options({
      address: {
        describe: 'Address for addition',
        type: 'string'
      },
      page: {
        describe: 'Page with verified contracts at etherscan',
        type: 'number'
      },
      pages: {
        coerce (arg) {
          const match = arg.match(/^(\d+)\.\.(\d+|latest)$/)
          if (!match) throw new RangeError(`Invalid pages ${arg}`)

          const down = parseInt(match[1], 10)
          if (match[2] === 'latest') return [down, 'latest']

          const up = parseInt(match[2], 10)
          if (down > up) throw new RangeError(`Invalid pages ${arg}`)

          return [down, up]
        },
        describe: '',
        type: 'string'
      },
      update: {
        default: false,
        describe: 'Fetch from etherscan while contracts not exists',
        type: 'boolean'
      }
    })
    .version()
    .help('help').alias('help', 'h')
    .argv
}

const fetchText = (() => {
  async function makeReq (url) {
    const res = await fetch(url)
    assert.equal(res.status, 200)
    return res.text()
  }

  const map = {}
  return (url, id) => {
    if (!id) return makeReq(url)

    if (!map[id]) {
      let last = 0
      map[id] = makeConcurrent(async (url) => {
        const sleep = 1000 - (Date.now() - last)
        await new Promise((resolve) => setTimeout(resolve, sleep))

        const res = await makeReq(url)
        last = Date.now()
        return res
      }, { concurrency: 1 })
    }
    return map[id](url)
  }
})()

async function soljsonVersionsLoad () {
  const text = await fetchText('https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/bin/list.txt')

  const soljsonVersions = {}
  for (const line of text.split('\n')) {
    const parsed = line.match(/([a-z0-9]+)\.js$/)
    if (!parsed) continue

    const commit = parsed[1].slice(0, 6)
    if (soljsonVersions[commit] && soljsonVersions[commit].includes('commit')) continue

    soljsonVersions[commit] = line.trim().slice(9, -3)
  }
  return soljsonVersions
}

function onExistsUpdate () {
  console.log(logSymbols.info, 'Existed contract is reached')
  process.exit(0)
}

const RE_COMPILER_VERSION = /([0-9]+\.[0-9]+\.[0-9]+)/
const RE_SWARM_SOURCE = /^bzzr:\/\/([0-9a-fA-F]{64})$/
const RE_CONSTURCTOR_ARGUMENTS = /^([0-9a-fA-F]+)-/
const RE_LIBRARY = /^(.*) : (0x[0-9a-fA-F]{40})$/

async function fetchAddressEtherscan (address) {
  const html = await fetchText(`https://etherscan.io/address/${address}`, 'etherscan')

  const $ = cheerio.load(html)
  const table = $('div#ContentPlaceHolder1_contractCodeDiv table')

  const name = $($(table[0]).find('td')[1]).text().trim()
  const entrypoint = `${name}.sol`
  const compiler = $($(table[0]).find('td')[3]).text().trim()
  const optimizationEnabled = $($(table[1]).find('td')[1]).text().trim() === 'Yes'
  const optimizationRuns = parseInt($($(table[1]).find('td')[3]).text().trim(), 10)
  const optimise = optimizationEnabled && optimizationRuns

  const code = $('div#dividcode')
  const src = code.find('pre#editor').text().trim()
  const abi = code.find('pre#js-copytextarea2').text().trim()
  const bin = code.find('#verifiedbytecode2').text().trim()

  let constructorArguments, libraries, swarmSource
  for (const item of Array.from(code.find('pre')).slice(3)) {
    const text = $(item).text().trim()
    if (text.startsWith('bzzr://')) {
      const match = RE_SWARM_SOURCE.exec(text)
      assert.ok(match, 'Swarm source is not valid')
      swarmSource = match[1].toLowerCase()

      const compilerMatch = RE_COMPILER_VERSION.exec(compiler)
      assert.ok(compilerMatch, 'Can not find compiler version')
      assert.ok(semver.gte(compilerMatch[1], '0.4.7'))
    } else if (text.includes('Decoded View')) {
      const match = RE_CONSTURCTOR_ARGUMENTS.exec(text)
      assert.ok(match && match[1].length % 2 === 0, 'Constructor Arguments is not valid')
      constructorArguments = match[1].toLowerCase()
    } else {
      if (!RE_LIBRARY.exec(text.split('\n')[0].trim())) assert.fail('Unknow pre field')

      libraries = { [entrypoint]: {} }
      for (const line of text.split('\n')) {
        const match = RE_LIBRARY.exec(line.trim())
        assert.ok(match, 'Libraries is not valid')
        libraries[entrypoint][match[1]] = match[2].toLowerCase()
      }
    }
  }

  return { name, entrypoint, compiler, optimise, src, abi, bin, constructorArguments, libraries, swarmSource }
}

async function fetchAddressBlockchair (address) {
  const text = await fetchText(`https://api.blockchair.com/ethereum/calls?q=recipient(${address}),type(create)`, 'blockchair')
  const result = JSON.parse(text)
  assert.equal(result.data.length, 1, `Expected not more than 1 rows, received: ${result.data.length}`)

  const row = result.data[0]
  if (row.index !== '0') assert.equal(row.index.slice(0, 2), '0.') // I'm not sure here, need ask blockchair
  const txid = row.transaction_hash + (row.index === '0' ? '' : ':' + row.index.slice(2))
  const txInfo = await blockchain.getTxInfo('foundation', txid)
  assert.equal(txInfo.address, address)
  assert.equal(txInfo.bin, row.input_hex)

  return { txid, bin: txInfo.bin }
}

async function fetchAddress (address, { soljsonVersions, update }) {
  address = address.toLowerCase()
  if (etherscanSkip.includes(address)) {
    return console.log(logSymbols.warning, `Address ${address} is not valid on etherscan, see: https://github.com/ethereumjs/ethereum-verified-contracts/issues?utf8=%E2%9C%93&q=label%3A%22etherscan+bug%22+`)
  }

  const exists = await contractLoader.existsByAddressNetwork(address, 'foundation')
  if (exists) {
    if (update) onExistsUpdate()
    return console.log(logSymbols.info, `Already exists: ${address}`)
  }

  const [etherscan, blockchair] = await Promise.all([
    fetchAddressEtherscan(address),
    fetchAddressBlockchair(address)
  ])
  console.log(logSymbols.info, `Load address ${address}`)

  // Trying fix etherscan...
  // Library in Contract Creation Code
  // Example: https://etherscan.io/address/0x551e7973dc165523ea3fcbc7b074004df218d2b1#code
  if (etherscan.bin.includes('__')) {
    etherscan.bin = linker.linkBytecode(etherscan.bin, etherscan.libraries)
  }

  // Constructor arguments shown twice, remove it from bytecode
  // Example: https://etherscan.io/address/0xe2cc64efb6c1fabb09fe6e59eba6df2dacb92915#code
  const constructorArguments = etherscan.constructorArguments || ''
  if (constructorArguments !== '' &&
      etherscan.bin === blockchair.bin &&
      etherscan.bin.endsWith(constructorArguments)) {
    etherscan.bin = etherscan.bin.slice(0, -constructorArguments.length)
  }
  assert.equal(etherscan.bin + constructorArguments, blockchair.bin)

  const compilerMark = etherscan.compiler.match(/([a-z0-9]+)$/)[1].slice(0, 6)
  const soljsonVersion = soljsonVersions[compilerMark] || soljsonVersions[compilersMap[compilerMark]]
  assert.ok(soljsonVersion, `Compiler version should be defined for ${address}`)

  const contract = {
    src: {
      [etherscan.entrypoint]: etherscan.src
    },
    abi: etherscan.abi,
    bin: etherscan.bin,
    info: {
      name: etherscan.name,
      entrypoint: etherscan.entrypoint,
      compiler: soljsonVersion,
      optimise: etherscan.optimise,
      network: 'foundation',
      txid: blockchair.txid,
      address,
      constructorArguments,
      libraries: etherscan.libraries,
      swarmSource: etherscan.swarmSource
    }
  }
  const added = await contractLoader.save(contract)
  if (!added && update) onExistsUpdate()

  console.log(logSymbols.success, address)
}

async function fetchPage (page, options) {
  const html = await fetchText(`https://etherscan.io/contractsVerified/${page}`, 'etherscan')
  console.log(logSymbols.info, `Load page ${page}`)

  const $ = cheerio.load(html)
  const addresses = $('tbody:nth-child(2) tr').map((i, el) => $(el).find('a').text().trim().toLowerCase()).get()
  for (const address of addresses) await fetchAddress(address, options)

  const match = $.text().match(/Page \d+ of (\d+)/)
  assert.ok(match)
  return match[1]
}

async function fetchPages (down, up, options) {
  for (let page = down; ; page += 1) {
    const total = await fetchPage(page, options)
    if (page >= (up === 'latest' ? total : up)) break
  }
}

async function main () {
  const args = getArgs()
  const soljsonVersions = await soljsonVersionsLoad()

  const options = { soljsonVersions, update: args.update }
  if (args.address) await fetchAddress(args.address, options)
  if (args.page) await fetchPage(args.page, options)
  if (args.pages) await fetchPages(...args.pages, options)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
