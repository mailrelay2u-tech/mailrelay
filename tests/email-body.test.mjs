import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Same logic as lib/gmail.ts body helpers
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeBody(part) {
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

function extractPlainBody(raw) {
  if (!raw) return ''
  const m = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (m) {
    const parts = raw.split(new RegExp(`--${escapeRegex(m[1].trim())}(?:--)?`))
    for (const p of parts) if (/content-type:\s*text\/plain/i.test(p)) return decodeBody(p)
  }
  const b = raw.indexOf('\r\n\r\n')
  if (b !== -1) return raw.slice(b + 4).trim()
  const bn = raw.indexOf('\n\n')
  if (bn !== -1) return raw.slice(bn + 2).trim()
  return raw
}

function extractHtmlBody(raw) {
  if (!raw) return ''
  const m = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (m) {
    const parts = raw.split(new RegExp(`--${escapeRegex(m[1].trim())}(?:--)?`))
    for (const p of parts) if (/content-type:\s*text\/html/i.test(p)) return decodeBody(p)
  }
  return ''
}

describe('quoted-printable decoding', () => {
  test('decodes =3D as equals sign', () => {
    const part = 'Content-Transfer-Encoding: quoted-printable\n\na=3Db'
    assert.equal(decodeBody(part), 'a=b')
  })

  test("decodes =27 as apostrophe (you're)", () => {
    const part = 'Content-Transfer-Encoding: quoted-printable\n\nyou=27re welcome'
    assert.equal(decodeBody(part), "you're welcome")
  })

  test('decodes =20 as space', () => {
    const part = 'Content-Transfer-Encoding: quoted-printable\n\nhello=20world'
    assert.equal(decodeBody(part), 'hello world')
  })

  test('unfolds soft line breaks =\\n', () => {
    const part = 'Content-Transfer-Encoding: quoted-printable\n\nhello=\nworld'
    assert.equal(decodeBody(part), 'helloworld')
  })

  test('unfolds soft line breaks =\\r\\n', () => {
    const part = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=\r\nworld'
    assert.equal(decodeBody(part), 'helloworld')
  })

  test('decodes HTML attribute =3D inside tag', () => {
    const part = 'Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n<p style=3D"color:red">It=27s working</p>'
    assert.equal(decodeBody(part), '<p style="color:red">It\'s working</p>')
  })
})

describe('base64 decoding', () => {
  test('decodes base64 plain text', () => {
    const text = 'Hello from base64!'
    const part = `Content-Transfer-Encoding: base64\n\n${Buffer.from(text).toString('base64')}`
    assert.equal(decodeBody(part), text)
  })

  test('decodes base64 with line breaks', () => {
    const text = 'Hello World'
    const encoded = Buffer.from(text).toString('base64').match(/.{1,4}/g).join('\n')
    const part = `Content-Transfer-Encoding: base64\n\n${encoded}`
    assert.equal(decodeBody(part), text)
  })
})

describe('multipart extraction', () => {
  const raw = [
    'Content-Type: multipart/alternative; boundary="b123"',
    '',
    '--b123',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hello plain text',
    '--b123',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Hello <b>HTML</b></p>',
    '--b123--',
  ].join('\n')

  test('extracts plain text from multipart', () => {
    assert.equal(extractPlainBody(raw), 'Hello plain text')
  })

  test('extracts HTML from multipart', () => {
    assert.equal(extractHtmlBody(raw), '<p>Hello <b>HTML</b></p>')
  })
})

describe('single-part emails', () => {
  test('extracts body after blank line', () => {
    assert.equal(extractPlainBody('From: x\r\nSubject: Hi\r\n\r\nThis is the body'), 'This is the body')
  })

  test('returns empty string for empty input', () => {
    assert.equal(extractPlainBody(''), '')
    assert.equal(extractHtmlBody(''), '')
  })
})
