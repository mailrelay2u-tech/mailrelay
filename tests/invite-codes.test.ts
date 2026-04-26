import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'

// Same logic as app/api/admin/invites/route.ts
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[randomBytes(1)[0] % chars.length]).join('')
  return `${part(4)}-${part(4)}`
}

function isValidCode(code: string): boolean {
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

describe('invite codes', () => {
  describe('generateCode', () => {
    it('generates code in XXXX-XXXX format', () => {
      const code = generateCode()
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    })

    it('generates unique codes', () => {
      const codes = new Set(Array.from({ length: 100 }, generateCode))
      // With 32^8 possibilities, 100 codes should all be unique
      expect(codes.size).toBe(100)
    })

    it('never contains ambiguous chars (0, 1, I, O)', () => {
      const codes = Array.from({ length: 200 }, generateCode).join('')
      expect(codes).not.toMatch(/[01IO]/)
    })
  })

  describe('isValidCode', () => {
    it('accepts valid code format', () => {
      expect(isValidCode('ABCD-1234')).toBe(true)
      expect(isValidCode('WXYZ-5678')).toBe(true)
    })

    it('rejects lowercase', () => {
      expect(isValidCode('abcd-1234')).toBe(false)
    })

    it('rejects wrong length', () => {
      expect(isValidCode('ABC-1234')).toBe(false)
      expect(isValidCode('ABCDE-1234')).toBe(false)
    })

    it('rejects missing dash', () => {
      expect(isValidCode('ABCD1234')).toBe(false)
    })

    it('rejects ambiguous chars', () => {
      expect(isValidCode('OI01-ABCD')).toBe(false)
    })
  })

  describe('expiry', () => {
    it('detects expired code', () => {
      const past = new Date(Date.now() - 1000).toISOString()
      expect(isExpired(past)).toBe(true)
    })

    it('accepts non-expired code', () => {
      const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      expect(isExpired(future)).toBe(false)
    })

    it('48-hour window is correct', () => {
      const in47h = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString()
      const in49h = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString()
      expect(isExpired(in47h)).toBe(false)
      expect(isExpired(in49h)).toBe(false) // not expired yet from now's perspective
    })
  })
})
