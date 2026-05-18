import { test } from 'node:test'
import assert from 'node:assert/strict'

// Exact functions from lib/gmail.ts
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getHeader(part, name) {
  const match = part.match(new RegExp(`(?:^|\r?\n)${name}:\\s*([^\r\n]+)`, 'i'))
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

test('real Outlier email - verify HTML extraction and QP decoding', () => {
  // Simplified version of the actual structure
  const email = `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary=outer

--outer
Content-Type: multipart/alternative; boundary=inner

--inner
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: quoted-printable

<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org=
/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html>
  <body>
    <div style=3D"max-width: 567px; margin: 0 auto; padding: 32px; border: 1=
px solid #e5e7eb; background-color: #ffffff;">
      <h1 style=3D"font-size: 24px; font-weight: 600; text-align: center; co=
lor: #000000; margin: 0 0 32px 0;">Let=27s Get Started</h1>
      <p style=3D"font-size: 16px; font-weight: 400; text-align: center; col=
or: #000000; margin: 0 0 32px 0;">Click below to sign in securely to your O=
utlier account.</p>
      <div style=3D"text-align: center; margin-bottom: 32px;">
        <a href=3D"http://url9405.outlier.ai/ls/click?upn=3Du001.ekXzrh6HTgO=
sQrpQbkIFH3a3hLgV6XqHBzyVhQ3kpPQcQvsCnkHa3T513N-2BxYrah71RBY-2BbVlKe2ZCh=
1lb-2FimCDBP4SKePj-2FZGjg8F2vpUqLEdsbF9pnupxVHT6h5-2FwFkdcSraoDOCID8RPyJ-=
2Fb0zA-3D-3D" style=3D"background-color: #F97316; color: #000000; padding: =
12px 24px; text-decoration: none; border-radius: 9999px; display: inline-bl=
ock;">Sign In to Outlier</a>
      </div>
      <p style=3D"font-size: 16px; font-weight: 400; text-align: center; col=
or: #000000; margin: 0 0 32px 0;">If you didn=27t request this email, you c=
an ignore it.</p>
      <div style=3D"text-align: center; font-size: 10px; color: #374151;">
        <p style=3D"margin: 0;">Our privacy policy can be found at <a href=3D=
"http://url9405.outlier.ai/ls/click?upn=3Du001.ekXzrh6HTgOsQrpQbkIFH3a3hL=
gV6XqHBzyVhQ3kpPQcQvsCnkHa3T513N-2BxYrah71RBY-2BbVlKe2ZCh1lb-2FimCDBP4SKePj-=
2FZGjg8F2vpUqLEdsbF9pnupxVHT6h5-2FwFkdcSraoDOCID8RPyJ-2Fb0zA-3D-3D" style=3D=
"color: #1155cc; text-decoration: underline;">https://outlier.ai/legal/priv=
acy-policy</a>. If you have questions, please contact us at <a href=3D"mail=
to:privacy@outlier.ai" style=3D"color: #1155cc; text-decoration: underline;=
">privacy@outlier.ai</a></p>
      </div>
    </div>
  </body>
</html>
--inner--
--outer--`

  const { html, text } = getBestBody(email)
  
  console.log('=== Test Results ===')
  console.log('HTML extracted:', html ? 'YES' : 'NO')
  console.log('HTML length:', html.length)
  console.log('Text extracted:', text ? 'YES' : 'NO')
  
  // Verification
  assert.ok(html.length > 0, 'Should extract HTML body')
  assert.ok(!html.includes('=3D'), 'Should not have =3D (undecoded QP)')
  assert.ok(!html.includes('=27'), 'Should not have =27 (undecoded QP)')
  assert.ok(!html.includes('=\n') && !html.includes('=\r'), 'Should not have soft line breaks')
  assert.ok(html.includes("Let's"), 'Should decode =27 as apostrophe')
  assert.ok(html.includes('href="'), 'Should have href=" not href=3D')
  assert.ok(html.includes('privacy-policy'), 'Should have complete URL (soft breaks removed)')
  
  console.log('\n✓ All assertions passed!')
})
