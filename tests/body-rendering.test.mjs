import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Fixed: no ^ anchor, matches header even when part starts with \r\n
function getHeader(part, name) {
  const match = part.match(new RegExp(`(?:^|\\r?\\n)${name}:\\s*([^\\r\\n]+)`, 'i'))
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

describe('Outlier exact structure: multipart/mixed → multipart/alternative → text/html QP', () => {
  // Exact structure of the Outlier email that was breaking
  // outer: multipart/mixed with boundary "outer"
  // inner: multipart/alternative with boundary "inner"
  // parts start with \r\n after boundary split — this was breaking getHeader
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
    "Let=27s Get Started=0AClick below to sign in.",
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<div style=3D"max-width:567px"><h1>Let=27s Get Started</h1><a href=3D"https://outlier.ai" style=3D"background:#F97316">Sign In</a></div>',
    '--inner--',
    '--outer--',
  ].join('\r\n')

  test('returns HTML not plain text', () => {
    const { html, text } = getBestBody(outlierEmail)
    assert.ok(html.length > 0, `HTML should not be empty, got html="${html}" text="${text}"`)
    assert.ok(html.includes('<div'), `Should contain HTML tags, got: ${html}`)
  })

  test('HTML has no =3D (undecoded QP)', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(!html.includes('=3D'), `Should not contain =3D, got: ${html}`)
  })

  test('HTML has no &lt; or &gt; (escaped HTML)', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(!html.includes('&lt;'), `Should not contain &lt;`)
    assert.ok(!html.includes('&gt;'), `Should not contain &gt;`)
  })

  test("HTML decodes =27 to apostrophe in Let's", () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.includes("Let's Get Started"), `got: ${html}`)
  })

  test('style attribute decoded: style=3D"..." → style="..."', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.includes('style="max-width:567px"'), `got: ${html}`)
  })

  test('href decoded: href=3D"..." → href="..."', () => {
    const { html } = getBestBody(outlierEmail)
    assert.ok(html.includes('href="https://outlier.ai"'), `got: ${html}`)
  })
})

describe('getHeader works when part starts with \\r\\n (after boundary split)', () => {
  test('finds content-type with leading newline', () => {
    const part = '\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>body</p>'
    assert.ok(getHeader(part, 'content-type').includes('text/html'))
  })

  test('finds content-transfer-encoding with leading newline', () => {
    const part = '\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nbody'
    assert.ok(getHeader(part, 'content-transfer-encoding').includes('quoted-printable'))
  })
})

describe('single-part QP HTML', () => {
  test('decodes correctly', () => {
    const raw = 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p style=3D"color:red">Hello=20World</p>'
    assert.equal(getBestBody(raw).html, '<p style="color:red">Hello World</p>')
  })
})

describe('base64 HTML', () => {
  test('decodes correctly', () => {
    const body = '<p>Hello from base64</p>'
    const raw = `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}`
    assert.equal(getBestBody(raw).html, body)
  })
})

describe('plain text fallback', () => {
  test('returns text when no HTML part', () => {
    const raw = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nyou=27re welcome'
    const { html, text } = getBestBody(raw)
    assert.equal(html, '')
    assert.equal(text, "you're welcome")
  })
})

describe('individual QP sequences', () => {
  test('=3D → =', () => assert.equal(decodeBodyPart('Content-Transfer-Encoding: quoted-printable\r\n\r\na=3Db'), 'a=b'))
  test('=20 → space', () => assert.equal(decodeBodyPart('Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=20world'), 'hello world'))
  test('=27 → apostrophe', () => assert.equal(decodeBodyPart('Content-Transfer-Encoding: quoted-printable\r\n\r\nyou=27re'), "you're"))
  test('soft break =\\r\\n removed', () => assert.equal(decodeBodyPart('Content-Transfer-Encoding: quoted-printable\r\n\r\nhello=\r\nworld'), 'helloworld'))
  test('=0A → newline', () => assert.equal(decodeBodyPart('Content-Transfer-Encoding: quoted-printable\r\n\r\nline1=0Aline2'), 'line1\nline2'))
})
