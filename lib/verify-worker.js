const debug = require('debug')('verify')
const contractVerify = require('./contract-verify')
const soljson = require('../lib/soljson')

async function verify (contract) {
  try {
    return { warnings: await contractVerify.verify(contract, soljson.load) }
  } catch (err) {
    return { err: err.toString() + err.stack }
  }
}

async function main () {
  await new Promise((resolve, reject) => {
    function sendMessage (msg) {
      debug(`Send message to main process from ${process.pid}: ${msg.event}`)
      const wasSent = process.send(msg, (err) => { if (err) reject(err) })
      if (!wasSent) this.shutdown(new Error('process.send returned false'))
    }

    process.on('message', async (msg) => {
      debug(`Received message from main process to ${process.pid}: ${msg.event}`)
      switch (msg.event) {
        case 'verify':
          const value = await verify(msg.value)
          return sendMessage({ event: 'result', value })

        case 'done':
          return resolve()

        default:
          reject(new Error(`Unknow message event: ${msg.event}`))
      }
    })

    sendMessage({ event: 'ready' })
  })
}

main()
  .catch((err) => {
    console.error(err)
    return err
  })
  .then((err) => process.exit(err ? 1 : 0))
