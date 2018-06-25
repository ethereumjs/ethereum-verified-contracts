const assert = require('assert')

// Part of code from https://github.com/ethereumjs/ethereumjs-abi

// Convert from short to canonical names
function elementaryName (name) {
  if (name.startsWith('int[')) {
    return 'int256' + name.slice(3)
  } else if (name === 'int') {
    return 'int256'
  } else if (name.startsWith('uint[')) {
    return 'uint256' + name.slice(4)
  } else if (name === 'uint') {
    return 'uint256'
  } else if (name.startsWith('fixed[')) {
    return 'fixed128x128' + name.slice(5)
  } else if (name === 'fixed') {
    return 'fixed128x128'
  } else if (name.startsWith('ufixed[')) {
    return 'ufixed128x128' + name.slice(6)
  } else if (name === 'ufixed') {
    return 'ufixed128x128'
  }
  return name
}

// Is a type an array?
function isArray (type) {
  return type.lastIndexOf(']') === type.length - 1
}

// Parse N in type[<N>] where "type" can itself be an array type.
function parseTypeArray (type) {
  const match = type.match(/(.*)\[(.*?)\]$/)
  return match[2] === '' ? 'dynamic' : parseInt(match[2], 10)
}

// Parse N from type<N>
function parseTypeN (type) {
  return parseInt(/^\D+(\d+)$/.exec(type)[1], 10)
}

// Convert type to required memory space
function typeSyze (type) {
  if (isArray(type)) {
    const size = parseTypeArray(type)
    const subSize = typeSyze(type.slice(0, type.lastIndexOf('[')), 10)
    return size === 'dynamic' ? 32 : subSize * size
  }

  const isBytes = type.startsWith('bytes') && type !== 'bytes'
  const isUintInt = type.startsWith('uint') || type.startsWith('int')
  if (isBytes || isUintInt) {
    const size = parseTypeN(type)
    if (isBytes && (size < 1 || size > 32)) throw new Error(`Invalid bytes<N> width: ${size}`)
    if (isUintInt && (size % 8 || size < 8 || size > 256)) throw new Error(`Invalid int/uint<N> width: ${size}`)
  }

  return 32
}

function verify (types, data) {
  const buffer = Buffer.from(data, 'hex')
  const size = types.reduce((size, type) => size + typeSyze(elementaryName(type)), 0)
  assert.equal(size, buffer.length, `Not all data from constructor consumed: ${size} from ${buffer.length}`)
}

module.exports = {
  verify
}
