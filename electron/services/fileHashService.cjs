'use strict'

const fs = require('fs')
const crypto = require('crypto')

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function hashText(text) {
  return hashBuffer(Buffer.from(String(text ?? ''), 'utf8'))
}

async function hashFile(filePath) {
  const buffer = await fs.promises.readFile(filePath)
  return hashBuffer(buffer)
}

module.exports = {
  hashBuffer,
  hashFile,
  hashText,
}