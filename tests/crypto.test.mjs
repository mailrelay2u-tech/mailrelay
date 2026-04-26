import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Same logic as lib/crypto.ts
const ALG = 'aes-256-gcm'
const SECRET = 'test_secret_32chars_padding_here'
const getKey = () => scryptSync(SECRET, 'mailrelay', 32)

function encrypt(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

function decrypt(ciphertext) {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const decipher = createDecipheriv(ALG, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

describe('crypto — AES-256-GCM', () => {
  test('round-trips a plain string', () => {
    assert.equal(decrypt(encrypt('my-gmail-app-password')), 'my-gmail-app-password')
  })

  test('produces different ciphertext each call (random IV)', () => {
    assert.notEqual(encrypt('same'), encrypt('same'))
  })

  test('ciphertext has 3 colon-separated parts: iv:tag:data', () => {
    const parts = encrypt('test').split(':')
    assert.equal(parts.length, 3)
    assert.equal(parts[0].length, 24) // 12-byte IV = 24 hex chars
    assert.equal(parts[1].length, 32) // 16-byte tag = 32 hex chars
  })

  test('throws on tampered ciphertext', () => {
    const parts = encrypt('secret').split(':')
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a')
    assert.throws(() => decrypt(parts.join(':')))
  })

  test('encrypts empty string', () => {
    assert.equal(decrypt(encrypt('')), '')
  })

  test('encrypts unicode and special chars', () => {
    const plain = 'pässwörd 🔑 <>&"'
    assert.equal(decrypt(encrypt(plain)), plain)
  })

  test('encrypts a real-looking Gmail app password', () => {
    const appPass = 'abcd efgh ijkl mnop'
    assert.equal(decrypt(encrypt(appPass)), appPass)
  })
})
