const assert = require('assert')
const path = require('path')
const fs = require('fs-extra')
const solc = require('solc')
const fetch = require('node-fetch')
const requireFromString = require('require-from-string')

// If this will be used from few node instances with same cache directory, lock file is required
const CACHE_DIR = process.env.SOLJSON_CACHE_DIR || path.join(__dirname, '..', '.soljson')

const getFileName = (version) => `soljson-v${version}.js`
const getFullPath = (version, dir) => path.join(dir, getFileName(version))

async function download (version, dir = CACHE_DIR) {
  const url = `https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/bin/soljson-v${version}.js`
  const res = await fetch(url)
  assert.equal(res.status, 200)
  const code = await res.text()
  await fs.outputFile(getFullPath(version, dir), code)
}

async function exists (version, dir = CACHE_DIR) {
  try {
    const stat = await fs.stat(getFullPath(version, dir))
    return stat.isFile()
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
}

const cache = {}
async function load (version, dir = CACHE_DIR) {
  if (!cache[version]) {
    if (!await exists(version, dir)) await download(version, dir)

    const code = await fs.readFile(getFullPath(version, dir), 'utf8')
    cache[version] = solc.setupMethods(requireFromString(code, getFileName(version)))
  }

  return cache[version]
}

module.exports = {
  download,
  exists,
  load
}
