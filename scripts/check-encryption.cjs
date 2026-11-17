const { app, safeStorage } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

// Dedicated test profile; never reads or modifies the user's saved credentials.
const testDirectory = path.resolve(__dirname, '../.scratch/encryption-test')
fs.mkdirSync(testDirectory, { recursive: true })
app.setPath('userData', testDirectory)
app.whenReady().then(async () => {
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true)
  const synthetic = JSON.stringify({ username: 'synthetic-check', password: 'not-a-real-password' })
  const encrypted = await safeStorage.encryptStringAsync(synthetic)
  assert.notEqual(encrypted.toString('utf8'), synthetic)
  const decrypted = await safeStorage.decryptStringAsync(encrypted)
  assert.equal(decrypted.result, synthetic)
  fs.writeFileSync(path.join(testDirectory, 'result.json'), JSON.stringify({ available: true, roundTripPassed: true }))
  console.log('Windows safeStorage encryption and decryption: passed')
  app.quit()
}).catch(() => {
  fs.writeFileSync(path.join(testDirectory, 'result.json'), JSON.stringify({ available: false, roundTripPassed: false }))
  console.error('Windows safeStorage verification failed')
  app.exit(1)
})
