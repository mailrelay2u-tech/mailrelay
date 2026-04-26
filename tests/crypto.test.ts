import { describe, it, expect } from 'vitest'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// Inline crypto logic — same as lib/crypto.ts but standalone for testing
const ALG = 'aes-256-gcm'
const SECRET = 'test_secret_32chars_padding_here'

function getKey() { return scryptSync(SECRET, 'mailrelay', 32) }

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':')
}

function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  const decipher = createDecipheriv(ALG, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

describe('crypto — AES-256-GCM encrypt/decrypt', () => {
  it('round-trips a plain string', () => {
    const plain = 'my-gmail-app-password'
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('produces different ciphertext each call (random IV)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })

  it('ciphertext has 3 colon-separated parts: iv:tag:data', () => {
    const parts = encrypt('test').split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toHaveLength(24) // 12-byte IV = 24 hex
    expect(parts[1]).toHaveLength(32) // 16-byte tag = 32 hex
  })

  it('throws on tampered ciphertext (GCM auth tag fails)', () => {
    const parts = encrypt('secret').split(':')
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a')
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('encrypts empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  it('encrypts unicode and special chars', () => {
    const plain = 'pässwörd 🔑 <>&"'
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('encrypts a real-looking Gmail app password', () => {
    const appPass = 'abcd efgh ijkl mnop'
    expect(decrypt(encrypt(appPass))).toBe(appPass)
  })
})
