import { describe, it, expect } from 'vitest'

// Re-implement the body helpers here for isolated testing
// (same logic as lib/gmail.ts)

function decodeBody(part: string): string {
  const blankLine = part.indexOf('\r\n\r\n')
  const blankLineN = part.indexOf('\n\n')
  const bodyStart = blankLine !== -1 ? blankLine + 4 : blankLineN !== -1 ? blankLineN + 2 : 0
  let body = part.slice(bodyStart).trim()

  if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
    body = body
      .replace(/=\r\n/g, '')
      .replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    if (/charset\s*=\s*["']?utf-8/i.test(part)) {
      try { body = Buffer.from(body, 'latin1').toString('utf8') } catch {}
    }
  }

  if (/content-transfer-encoding:\s*base64/i.test(part)) {
    try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  return body
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractPlainBody(raw: string): string {
  if (!raw) return ''
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`))
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) return decodeBody(part)
    }
  }
  const blankLine = raw.indexOf('\r\n\r\n')
  if (blankLine !== -1) return raw.slice(blankLine + 4).trim()
  const blankLineN = raw.indexOf('\n\n')
  if (blankLineN !== -1) return raw.slice(blankLineN + 2).trim()
  return raw
}

function extractHtmlBody(raw: string): string {
  if (!raw) return ''
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`))
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) return decodeBody(part)
    }
  }
  return ''
}

describe('email body decoding', () => {
  describe('quoted-printable decoding', () => {
    it('decodes =3D as equals sign', () => {
      const part = [
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'a=3Db',
      ].join('\n')
      expect(decodeBody(part)).toBe('a=b')
    })

    it('decodes apostrophe =27', () => {
      const part = [
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        "you=27re welcome",
      ].join('\n')
      expect(decodeBody(part)).toBe("you're welcome")
    })

    it('unfolds soft line breaks (=\\n)', () => {
      const part = [
        'Content-Type: text/plain',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'hello=\nworld',
      ].join('\n')
      expect(decodeBody(part)).toBe('helloworld')
    })

    it('unfolds soft line breaks (=\\r\\n)', () => {
      const part = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=\r\nworld'
      expect(decodeBody(part)).toBe('helloworld')
    })

    it('decodes =20 as space', () => {
      const part = [
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'hello=20world',
      ].join('\n')
      expect(decodeBody(part)).toBe('hello world')
    })

    it('handles mixed QP sequences', () => {
      const part = [
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<p style=3D"color:red">It=27s working</p>',
      ].join('\n')
      expect(decodeBody(part)).toBe('<p style="color:red">It\'s working</p>')
    })
  })

  describe('base64 decoding', () => {
    it('decodes base64 plain text', () => {
      const text = 'Hello from base64!'
      const encoded = Buffer.from(text).toString('base64')
      const part = [
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        encoded,
      ].join('\n')
      expect(decodeBody(part)).toBe(text)
    })

    it('decodes base64 with line breaks (as email clients send)', () => {
      const text = 'Hello World'
      const encoded = Buffer.from(text).toString('base64')
      // Split into 4-char chunks with newlines (like real email)
      const chunked = encoded.match(/.{1,4}/g)!.join('\n')
      const part = [
        'Content-Transfer-Encoding: base64',
        '',
        chunked,
      ].join('\n')
      expect(decodeBody(part)).toBe(text)
    })
  })

  describe('multipart extraction', () => {
    const multipartRaw = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="boundary123"',
      '',
      '--boundary123',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello plain text',
      '--boundary123',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<p>Hello <b>HTML</b></p>',
      '--boundary123--',
    ].join('\n')

    it('extracts plain text from multipart', () => {
      expect(extractPlainBody(multipartRaw)).toBe('Hello plain text')
    })

    it('extracts HTML from multipart', () => {
      expect(extractHtmlBody(multipartRaw)).toBe('<p>Hello <b>HTML</b></p>')
    })

    it('prefers HTML body when both present', () => {
      const html = extractHtmlBody(multipartRaw)
      expect(html).toBeTruthy()
      expect(html).toContain('<p>')
    })
  })

  describe('single-part emails', () => {
    it('extracts body from single-part plain text', () => {
      const raw = 'From: test@x.com\r\nSubject: Hi\r\n\r\nThis is the body'
      expect(extractPlainBody(raw)).toBe('This is the body')
    })

    it('returns empty string for empty input', () => {
      expect(extractPlainBody('')).toBe('')
      expect(extractHtmlBody('')).toBe('')
    })
  })
})
