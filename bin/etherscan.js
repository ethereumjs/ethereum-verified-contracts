const assert = require('assert')
const yargs = require('yargs')
const makeConcurrent = require('make-concurrent')
const fetch = require('node-fetch')
const cheerio = require('cheerio')
const logSymbols = require('log-symbols')
const blockchain = require('../lib/blockchain')
const contractLoader = require('../lib/contract-loader')
const compilersMap = require('../lib/compilers-map')
const etherscanConstructorArguments = require('../lib/etherscan-constructor-arguments')
const etherscanCreationTxIds = require('../lib/etherscan-creation-txids')

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
  let last = Date.now()
  return makeConcurrent(async (url) => {
    const sleep = 1000 - (Date.now() - last)
    await new Promise((resolve) => setTimeout(resolve, sleep))

    const res = await fetch(url)
    assert.equal(res.status, 200)
    const text = await res.text()
    last = Date.now()
    return text
  }, { concurrency: 1 })
})()

const soljsonVersions = {}
async function soljsonVersionsLoad () {
  const text = await fetchText('https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/bin/list.txt')
  for (const line of text.split('\n')) {
    const parsed = line.match(/([a-z0-9]+)\.js$/)
    if (!parsed) continue

    const commit = parsed[1].slice(0, 6)
    if (soljsonVersions[commit] && soljsonVersions[commit].includes('commit')) continue

    soljsonVersions[commit] = line.trim().slice(9, -3)
  }
}

function onExistsUpdate () {
  console.log(logSymbols.info, 'Existed contract is reached')
  process.exit(0)
}

async function fetchAddress (address, { update }) {
  address = address.toLowerCase()
  const exists = await contractLoader.existsByAddressNetwork(address, 'foundation')
  if (exists) {
    if (update) onExistsUpdate()
    return console.log(logSymbols.info, `Already exists: ${address}`)
  }

  const html = await fetchText(`https://etherscan.io/address/${address}`)
  console.log(logSymbols.info, `Load address ${address}`)

  const $ = cheerio.load(html)
  const table = $('div#ContentPlaceHolder1_contractCodeDiv table')

  const name = $($(table[0]).find('td')[1]).text().trim()
  const compiler = $($(table[0]).find('td')[3]).text().trim()
  const optimizationEnabled = $($(table[1]).find('td')[1]).text().trim() === 'Yes'
  const optimizationRuns = parseInt($($(table[1]).find('td')[3]).text().trim(), 10)
  const optimise = optimizationEnabled && optimizationRuns

  const code = $('div#dividcode')
  const src = code.find('pre#editor').text().trim()
  const abi = code.find('pre#js-copytextarea2').text().trim()

  let cargs = etherscanConstructorArguments[address] || ''
  const cargsHTML = $(code.find('pre')[3]).html()
  if (cargsHTML) {
    const match = cargsHTML.match(/^([0-9a-f]+)</)
    assert.ok(match && match[1].length % 2 === 0, 'Contructor Arguments is not valid')
    cargs = match[1]
  }

  const txid = $('#ContentPlaceHolder1_trContract > td:nth-child(2) > span > a').text().trim() || etherscanCreationTxIds[address]
  const txInfo = await blockchain.getTxInfo('foundation', txid)
  assert.equal(txInfo.address, address)

  const compilerMark = compiler.match(/([a-z0-9]+)$/)[1].slice(0, 6)
  const soljsonVersion = soljsonVersions[compilerMark] || soljsonVersions[compilersMap[compilerMark]]
  assert.ok(soljsonVersion, `Compiler version should be defined for ${address}`)

  const contract = {
    src: {
      [`${name}.sol`]: src
    },
    abi,
    bin: txInfo.bin,
    info: {
      name,
      entrypoint: `${name}.sol`,
      compiler: soljsonVersion,
      optimise,
      network: 'foundation',
      txid,
      address,
      constructor: cargs
    }
  }
  const added = await contractLoader.save(contract)
  if (!added && update) onExistsUpdate()

  console.log(logSymbols.success, address)
}

async function fetchPage (page, options) {
  const html = await fetchText(`https://etherscan.io/contractsVerified/${page}`)
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
  await soljsonVersionsLoad()

  const options = { update: args.update }
  if (args.address) await fetchAddress(args.address, options)
  if (args.page) await fetchPage(args.page, options)
  if (args.pages) await fetchPages(...args.pages, options)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
