import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getHeader(part, name) {
  const match = part.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'im'))
  return match ? match[1].trim().toLowerCase() : ''
}

function decodeBodyPart(part) {
  const crlfIdx = part.indexOf('\r\n\r\n')
  const lfIdx = part.indexOf('\n\n')
  const bodyStart = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
  const headers = part.slice(0, bodyStart)
  let body = part.slice(bodyStart).trim()

  const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()
  const charset = (headers.match(/charset\s*=\s*["']?([^"'\s;]+)/i)?.[1] ?? 'utf-8').toLowerCase()

  if (enc === 'quoted-printable') {
    body = body
      .replace(/=\r\n/g, '')
      .replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    if (charset === 'utf-8') {
      try { body = Buffer.from(body, 'latin1').toString('utf8') } catch {}
    }
  } else if (enc === 'base64') {
    try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  return body
}

function getBestBody(raw, depth = 0) {
  if (!raw || depth > 5) return { html: '', text: '' }

  const boundaryMatch = raw.match(/boundary=\s*"?([^"\r\n;]+)"?/i)

  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    // Split on \n--boundary, slice off preamble, filter closing --
    const parts = raw
      .split(new RegExp(`\r?\n--${escapeRegex(boundary)}`))
      .slice(1)
      .filter(p => !p.startsWith('--'))

    let htmlPart = ''
    let textPart = ''

    for (const part of parts) {
      const ct = getHeader(part, 'content-type')
      if (!ct) continue

      if (ct.includes('multipart/') && /boundary=/i.test(part)) {
        const nested = getBestBody(part, depth + 1)
        if (nested.html && !htmlPart) htmlPart = nested.html
        if (nested.text && !textPart) textPart = nested.text
        continue
      }

      if (ct.includes('text/html') && !htmlPart) {
        htmlPart = decodeBodyPart(part)
      } else if (ct.includes('text/plain') && !textPart) {
        textPart = decodeBodyPart(part)
      }
    }

    return { html: htmlPart, text: textPart }
  }

  const topType = getHeader(raw, 'content-type')
  if (topType.includes('text/html')) return { html: decodeBodyPart(raw), text: '' }
  return { html: '', text: decodeBodyPart(raw) }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Outlier email — nested multipart/mixed → multipart/alternative → text/html QP', () => {
  const outlierEmail = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    "Let=27s Get Started",
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<div style=3D"max-width: 567px;"><h1>Let=27s Get Started</h1><a href=3D"https://outlier.ai">Sign In</a></div>',
    '--inner--',
    '--outer--',
  ].join('\r\n')

  test('extracts HTML body — not raw escaped text', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.length > 0, 'HTML body should not be empty')
    assert.ok(!html.includes('=3D'), 'Should not contain =3D')
    assert.ok(!html.includes('&lt;'), 'Should not contain &lt;')
    assert.ok(!html.includes('&gt;'), 'Should not contain &gt;')
  })

  test('decodes =3D back to = in style attribute', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.includes('style="max-width: 567px;"'), `got: ${html}`)
  })

  test("decodes =27 back to apostrophe in Let's", () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.includes("Let's Get Started"), `got: ${html}`)
  })

  test('plain text also decoded correctly', () => {
    const { text } = getBestBody(outlierEmail)
    assert.ok(text.includes("Let's Get Started"), `got: ${text}`)
  })
})

describe('single-part QP HTML email', () => {
  const raw = 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p style=3D"color:red">Hello=20World</p>'

  test('decodes QP HTML correctly', () => {
    const { html } = getBestBody(raw)
    assert.equal(html, '<p style="color:red">Hello World</p>')
  })
})

describe('base64 HTML email', () => {
  const body = '<p>Hello from base64</p>'
  const raw = `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}`

  test('decodes base64 HTML body', () => {
    const { html } = getBestBody(raw)
    assert.equal(html, body)
  })
})

describe('plain text only email', () => {
  const raw = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nyou=27re welcome'

  test('returns text, empty html', () => {
    const { html, text } = getBestBody(raw)
    assert.equal(html, '')
    assert.equal(text, "you're welcome")
  })
})

describe('individual QP sequences', () => {
  test('=3D → =', () => {
    const p = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nstyle=3D"color:red"'
    assert.equal(decodeBodyPart(p), 'style="color:red"')
  })

  test('=20 → space', () => {
    const p = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=20world'
    assert.equal(decodeBodyPart(p), 'hello world')
  })

  test('=27 → apostrophe', () => {
    const p = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nyou=27re'
    assert.equal(decodeBodyPart(p), "you're")
  })

  test('soft line break =\\r\\n removed', () => {
    const p = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=\r\nworld'
    assert.equal(decodeBodyPart(p), 'helloworld')
  })

  test('=0A → newline', () => {
    const p = 'Content-Transfer-Encoding: quoted-printable\r\n\r\nline1=0Aline2'
    assert.equal(decodeBodyPart(p), 'line1\nline2')
  })
})
