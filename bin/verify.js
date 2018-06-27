const assert = require('assert')
const { fork } = require('child_process')
const os = require('os')
const path = require('path')
const yargs = require('yargs')
const logSymbols = require('log-symbols')
const simpleGit = require('simple-git/promise')
const debug = require('debug')('verify')
const contractLoader = require('../lib/contract-loader')

function getArgs () {
  return yargs
    .usage('Usage: $0 [options]')
    .wrap(yargs.terminalWidth())
    .options({
      address: {
        coerce: (value) => {
          value = value.toLowerCase()
          return (obj) => obj.info.address === value
        },
        describe: 'Verify only contract with address',
        type: 'string'
      },
      compiler: {
        coerce: (value) => (obj) => obj.info.compiler === value,
        describe: 'Verify contract only with specific compiler',
        type: 'string'
      },
      'git-not-commited': {
        describe: 'Verify only contracts which was changed and not commited to git',
        type: 'boolean'
      },
      'git-last-commited': {
        describe: 'Verify only contracts which were changed in last commit',
        type: 'boolean'
      },
      id: {
        coerce: (value) => {
          value = value.toLowerCase()
          return (obj) => obj.id === value
        },
        describe: 'Verify contract by id (address-chainId)',
        type: 'string'
      },
      jobs: {
        alias: 'j',
        coerce: (value) => {
          value = parseInt(value, 10)
          assert.ok(Number.isFinite(value) && value >= 1, 'Number of processes should be more than zero')
          return value
        },
        default: os.cpus().length,
        describe: 'Number of verification processes',
        type: 'number'
      },
      name: {
        coerce: (value) => (obj) => obj.info.name === value,
        describe: 'Verify contracts with name',
        type: 'string'
      },
      txid: {
        coerce: (value) => {
          value = value.toLowerCase()
          return (obj) => obj.info.txid === value
        },
        describe: 'Verify only contract with txid',
        type: 'string'
      }
    })
    .version()
    .help('help').alias('help', 'h')
    .argv
}

async function createGitBasedFilter (cmd) {
  const ids = {}
  const tryAdd = (name) => {
    const match = name.match(/^contracts\/(0x[a-f0-9]{40}-\d+)/)
    if (match) ids[match[1]] = true
  }

  const sg = simpleGit(path.join(__dirname, '..'))
  if (cmd === 'status') {
    const status = await sg.status()
    status.files.map((obj) => tryAdd(obj.path))
  }
  if (cmd === 'diff') {
    const text = await sg.show(['--name-only'])
    text.split('\n').map((name) => tryAdd(name))
  }

  return (obj) => ids[obj.id] !== undefined
}

async function main () {
  const args = getArgs()

  const filters = [
    args.address,
    args.compiler,
    args['git-not-commited'] && await createGitBasedFilter('status'),
    args['git-last-commited'] && await createGitBasedFilter('diff'),
    args.id,
    args.name,
    args.txid
  ]
  const filter = filters.find((x) => !!x)

  const contracts = await contractLoader.loadAll(filter)
  const contractsByCompiler = contracts.reduce((obj, contract) => {
    const compiler = contract.info.compiler
    if (obj[compiler]) obj[compiler].push(contract)
    else obj[compiler] = [contract]

    return obj
  }, {})

  const loadedCompilers = new Map(Object.keys(contractsByCompiler).map((compiler) => ([compiler, 0])))
  function selectCompiler () {
    let best = { compiler: null, value: -1 }
    for (const [compiler, value] of loadedCompilers.entries()) {
      if (value > best.value) best = { compiler, value }
    }
    return best.compiler
  }

  let stat = { verified: 0 }
  function onVerify (contract, err) {
    stat.verified += 1
    const progress = (stat.verified * 100 / contracts.length).toFixed(2)
    const logMsg = `${progress}% ${(new Date()).toISOString()} ${contract.info.address} ${contract.info.txid} ${contract.info.network}`
    console.log(logSymbols[err ? 'error' : 'success'], logMsg)
  }

  await Promise.all(new Array(args.jobs).fill(null).map(async (_, i) => {
    while (true) {
      const compiler = selectCompiler()
      if (!compiler) return
      if (contractsByCompiler[compiler].length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        continue
      }

      loadedCompilers.set(compiler, loadedCompilers.get(compiler) + 1)
      let contract = contractsByCompiler[compiler].pop()
      let count = 0

      await new Promise((resolve, reject) => {
        const worker = fork(path.join(__dirname, '..', 'lib', 'verify-worker.js'), [compiler])

        function sendMessage (msg) {
          debug(`Send message worker#${worker.pid}: ${msg.event}`)
          const wasSent = worker.send(msg, (err) => { if (err) reject(err) })
          if (!wasSent) reject(new Error('worker#send function returned false'))
        }

        function sendJob () {
          if (contract === null) {
            if (contractsByCompiler[compiler].length === 0) return sendMessage({ event: 'done' })
            contract = contractsByCompiler[compiler].pop()
          }

          sendMessage({ event: 'verify', value: contract })
        }

        worker.on('message', (msg) => {
          debug(`Received message from worker#${worker.pid}: ${msg.event}`)
          switch (msg.event) {
            case 'ready':
              return sendJob()

            case 'result':
              if (!contract) {
                reject(new Error(`Received result for unknow contract`))
                return worker.kill()
              }

              const err = msg.value

              // It is not clear why, but if few contracts verified in same process, sometimes solc produce wrong result
              if (err && count > 0) {
                contractsByCompiler[compiler].push(contract)
                return sendMessage({ event: 'done' })
              }
              count += 1

              onVerify(contract, err)

              contract = null
              return err ? reject(err) : sendJob()

            default:
              reject(new Error(`Unknow message event: ${msg.event}`))
              worker.kill()
          }
        })

        worker.on('exit', (code, signal) => {
          code === 0 ? resolve() : reject(new Error(`Worker exit with code ${code}, signal ${signal}`))
        })
      })

      loadedCompilers.set(compiler, loadedCompilers.get(compiler) - 1)
      if (loadedCompilers.get(compiler) === 0) loadedCompilers.delete(compiler)
    }
  }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
