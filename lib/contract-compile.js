const assert = require('assert')
const semver = require('semver')
const linker = require('solc/linker')
const compilersMap = require('../lib/compilers-map')

function compileV0411 (solc, options) {
  const contractName = options.name
  const input = JSON.stringify({
    language: 'Solidity',
    sources: Object.entries(options.src).reduce((obj, [name, content]) => Object.assign(obj, { [name]: { content } }), {}),
    settings: {
      optimizer: {
        enabled: !!options.optimise,
        runs: options.optimise || 0
      },
      libraries: options.libraries,
      outputSelection: {
        [options.entrypoint]: {
          [contractName]: ['abi', 'evm.bytecode']
        }
      }
    }
  })
  const result = JSON.parse(solc.compileStandardWrapper(input))

  const ew = result.errors || []
  const errors = ew.filter((err) => err.severity === 'error')
  const warnings = ew.filter((err) => err.severity === 'warning')
  if (errors.length) throw new Error(errors.map((err) => JSON.stringify(err)).join('\n'))

  const obj = result.contracts[options.entrypoint][contractName]
  return { abi: JSON.stringify(obj.abi, null, 0), bin: obj.evm.bytecode.object, warnings }
}

function compileV021 (solc, options) {
  return compileV016(solc, options)
}

function compileV016 (solc, options) {
  const result = solc.compile({ sources: options.src }, options.optimise ? 1 : 0)
  const errors = (result.errors || []).filter((text) => text.includes(' Error: '))
  const warnings = (result.errors || []).filter((text) => text.includes(' Warning: '))
  if (errors.length) throw new Error(errors.join('\n').trim())

  const contract = result.contracts[options.name]
  const bin = linker.linkBytecode(contract.bytecode, options.libraries || {})
  return { abi: contract.interface.trim(), bin, warnings }
}

function compileEarly (solc, options) {
  assert.equal(Object.keys(options.src).length, 1, 'Before version 0.1.6 only one file allowed')

  const input = Object.values(options.src)[0]
  const result = solc.compile(input, options.optimise ? 1 : 0)
  if (result.errors) throw new Error(result.errors.join('\n').trim())

  const contract = result.contracts[options.name]
  return { abi: contract.interface.trim(), bin: contract.bytecode, warnings: [] }
}

function selectFunction (compilerVersion) {
  const parsedVersion = compilerVersion.match(/^([0-9]+\.[0-9]+\.[0-9]+)/)
  if (!parsedVersion) throw new Error(`Can not parse version to semver: ${compilerVersion}`)

  const version = parsedVersion[1]
  if (semver.gte(version, '0.4.11')) return compileV0411
  if (semver.gte(version, '0.2.1')) return compileV021
  if (semver.gte(version, '0.1.6')) return compileV016
  return compileEarly
}

const RE_COMPILER_VERSION = /([0-9]+\.[0-9]+\.[0-9]+)/
const RE_SWARM_REPLACE = /(a165627a7a72305820)([0-9a-f]{64})(0029)$/
function fixSwarmMetadata (compiled, options) {
  if (!options.swarmSource) return

  const version = RE_COMPILER_VERSION.exec(options.compiler)[1]
  assert.ok(semver.gte(version, '0.4.7'), 'Swarm Source should not be defined for contracts with compiler <0.4.7')

  compiled.bin = compiled.bin.replace(RE_SWARM_REPLACE, `$1${options.swarmSource}$3`)
}

function getSolcId (solc) {
  const version = solc.semver()
  const solcId = version.match(/^.*?([a-z0-9]{8})/)[1].slice(0, 6)

  // TODO: need https://github.com/ethereum/solc-bin/pull/21 ?
  // Probably is valid
  if (solcId.match(/\d/)) return solcId

  return null
}

function compile (solc, options) {
  const compilerId = options.compiler.match(/([a-z0-9]+)$/)[1].slice(0, 6)
  const solcId = getSolcId(solc)
  if (compilersMap[solcId]) assert.equal(compilerId, compilersMap[solcId])
  else if (solcId) assert.equal(compilerId, solcId)

  const compiled = selectFunction(options.compiler)(solc, options)
  fixSwarmMetadata(compiled, options) // because we do not now exact name of entrypoint
  return compiled
}

module.exports = {
  compile
}
