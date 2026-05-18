// Copy production functions to test exact Outlier email structure

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getHeader(part, name) {
  const match = part.match(new RegExp(`(?:^|\r?\n)${name}:\\s*([^\\r\\n]+)`, 'i'))
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

// Test: Outlier email has multipart/mixed > multipart/alternative > text/html with QP encoding
const outlierLike = `MIME-Version: 1.0\r
Content-Type: multipart/mixed; boundary="outer"\r
\r
--outer\r
Content-Type: multipart/alternative; boundary="inner"\r
\r
--inner\r
Content-Type: text/html; charset=utf-8\r
Content-Transfer-Encoding: quoted-printable\r
\r
<html><body><h1>Let=27s Get Started</h1><p>Click <a href=3D"https://outlier.ai/legal/privacy-policy">here</a></p><p>Our privacy policy can be found at https://outlier.ai/le=\r
gal/privacy-policy</p></body></html>\r
--inner--\r
--outer--\r
`;

const { html, text } = getBestBody(outlierLike)

console.log('=== Outlier-like Email Test ===')
console.log('HTML extracted:', !!html)
console.log('HTML length:', html.length)
console.log('\n=== Quality Checks ===')
console.log('✓ Has "Let\'s" (apostrophe decoded):', html.includes("Let's") ? 'YES' : 'NO - FAIL')
console.log('✓ Has href=" (not href=3D):', html.includes('href="') ? 'YES' : 'NO - FAIL')
console.log('✓ Has /legal/privacy-policy (soft line break removed):', html.includes('/legal/privacy-policy') ? 'YES' : 'NO - FAIL')
console.log('✓ No =27 remaining:', !html.includes('=27') ? 'YES' : 'NO - FAIL')
console.log('✓ No =3D remaining:', !html.includes('=3D') ? 'YES' : 'NO - FAIL')
console.log('\n=== Raw HTML Output (first 500 chars) ===')
console.log(html.substring(0, 500))
