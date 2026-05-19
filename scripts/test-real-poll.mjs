import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { scryptSync, createDecipheriv } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

loadEnvFile('.env.local')

const args = parseArgs(process.argv.slice(2))
const sinceMinutes = Number(args['since-minutes'] ?? 1440)
const limit = Number(args.limit ?? 25)
const send = Boolean(args.send)
const toOverride = args.to

if (args.help) {
  printHelp()
  process.exit(0)
}

const requiredEnv = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]

for (const name of requiredEnv) {
  if (!process.env[name]) fail(`Missing ${name} in .env.local`)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

if (args['list-accounts']) {
  await listAccounts()
} else {
  if (!args.account) {
    fail('Missing --account. Use the Gmail account email or gmail_accounts.id.')
  }

  if (send && !toOverride) {
    fail('Missing --to. For local testing, --send requires an explicit test recipient.')
  }

  const pollEnv = [
    'ENCRYPTION_SECRET',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
  ]

  for (const name of pollEnv) {
    if (!process.env[name]) fail(`Missing ${name} in .env.local`)
  }

  const account = await loadAccount(args.account)
  const rules = await loadRules(account.id)
  const testRules = buildRules(rules, args)
  const alreadyForwarded = args['ignore-dedupe'] ? new Set() : await loadAlreadyForwarded(account.id)

  console.log(`Account: ${account.email}`)
  console.log(`Mode: ${send ? `SEND to ${toOverride}` : 'DRY RUN'}`)
  console.log(`Search window: last ${sinceMinutes} minute(s)`)
  console.log(`Rules: ${testRules.map(r => r.name).join(', ') || '(none)'}`)

  const matches = await pollAccount(account, testRules, alreadyForwarded, sinceMinutes, limit)

  if (!matches.length) {
    console.log('No matching messages found.')
  } else {
    console.log(`Matched ${matches.length} message(s).`)

    for (const match of matches) {
      console.log('')
      console.log(`- ${match.subject || '(no subject)'}`)
      console.log(`  From: ${match.from}`)
      console.log(`  Rule: ${match.rule.name}`)
      console.log(`  Message-ID: ${match.messageId}`)
      console.log(`  HTML decoded: ${match.hasHtml ? 'yes' : 'no'}`)
      console.log(`  QP artifacts: ${match.bodyContent.includes('=3D') || match.bodyContent.includes('=20') ? 'present' : 'none'}`)
      if (args['show-artifacts']) {
        for (const marker of ['=3D', '=20']) {
          const index = match.bodyContent.indexOf(marker)
          if (index !== -1) {
            const start = Math.max(0, index - 80)
            const end = Math.min(match.bodyContent.length, index + 120)
            console.log(`  ${marker} context: ${match.bodyContent.slice(start, end).replace(/\s+/g, ' ')}`)
          }
        }
      }

      if (send) {
        await sendForward(match, [toOverride])
        console.log(`  Sent test forward to ${toOverride}`)
      }
    }
  }
}

async function listAccounts() {
  const { data, error } = await supabase
    .from('gmail_accounts')
    .select('id, email, active, label')
    .order('email')

  if (error) fail(`Could not list accounts: ${error.message}`)
  if (!data?.length) {
    console.log('No gmail_accounts rows found.')
    return
  }

  for (const account of data) {
    console.log(`${account.active ? 'active  ' : 'inactive'} ${account.email} ${account.label ? `(${account.label}) ` : ''}${account.id}`)
  }
}

async function loadAccount(accountArg) {
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountArg)
    ? 'id'
    : 'email'

  const query = supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted, active')
    .eq(column, accountArg)
    .limit(1)
    .maybeSingle()

  const { data, error } = await query
  if (error) fail(`Could not load account: ${error.message}`)
  if (!data) fail(`No gmail_accounts row found for ${accountArg}`)
  if (!data.active) fail(`Account ${data.email} is inactive`)
  return data
}

async function loadRules(accountId) {
  const { data, error } = await supabase
    .from('rules')
    .select('id, name, from_filter, subject_filter, active, rule_recipients(recipients(email))')
    .eq('account_id', accountId)
    .eq('active', true)

  if (error) fail(`Could not load rules: ${error.message}`)

  return (data ?? []).map(rule => ({
    id: rule.id,
    name: rule.name,
    from_filter: rule.from_filter,
    subject_filter: rule.subject_filter,
    recipients: (rule.rule_recipients ?? [])
      .map(rr => rr.recipients?.email)
      .filter(Boolean),
  }))
}

function buildRules(dbRules, cliArgs) {
  if (cliArgs.from || cliArgs.subject) {
    return [{
      id: 'local-test-rule',
      name: 'Local Test Rule',
      from_filter: cliArgs.from ?? null,
      subject_filter: cliArgs.subject ?? null,
      recipients: toOverride ? [toOverride] : [],
    }]
  }

  return dbRules
}

async function loadAlreadyForwarded(accountId) {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('forwarded_log')
    .select('message_id')
    .eq('account_id', accountId)
    .gte('forwarded_at', since7d)
    .not('message_id', 'is', null)

  if (error) fail(`Could not load forwarded_log: ${error.message}`)
  return new Set((data ?? []).map(row => row.message_id).filter(Boolean))
}

async function pollAccount(account, rules, forwardedSet, minutes, maxMessages) {
  const password = decrypt(account.app_password_encrypted)
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: account.email, pass: password },
    logger: false,
    socketTimeout: 10000,
    greetingTimeout: 10000,
  })

  const results = []
  const sinceDate = new Date(Date.now() - minutes * 60 * 1000)
  const folders = ['INBOX', '[Gmail]/Spam']

  await client.connect()
  try {
    for (const folder of folders) {
      let lock
      try {
        lock = await client.getMailboxLock(folder)
      } catch {
        continue
      }

      try {
        const uids = await client.search({ since: sinceDate }, { uid: true })
        const uidList = Array.isArray(uids) ? uids.slice(-maxMessages) : []
        if (!uidList.length) continue

        const messages = client.fetch(uidList, { envelope: true, source: true }, { uid: true })

        for await (const msg of messages) {
          const subject = msg.envelope?.subject || ''
          const from = msg.envelope?.from?.[0]?.address || ''
          const messageId = msg.envelope?.messageId || `uid-${msg.uid}`

          if (forwardedSet.has(messageId)) continue
          if (from.toLowerCase() === account.email.toLowerCase()) continue

          const rule = rules.find(r => matchesRule(r, from, subject))
          if (!rule) continue

          const raw = msg.source?.toString() ?? ''
          const { html, text } = getBestBody(raw)
          const safeHtml = html ? extractBodyContent(html) : ''
          const bodyContent = safeHtml
            ? safeHtml
            : text
              ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(text)}</pre>`
              : '<p style="color:#6b7280">(No message body)</p>'

          results.push({
            subject,
            from,
            messageId,
            rule,
            bodyContent,
            hasHtml: Boolean(safeHtml),
          })
        }
      } finally {
        lock.release()
      }
    }
  } finally {
    try { await client.logout() } catch {}
  }

  return results
}

function matchesRule(rule, from, subject) {
  const fromMatch = !rule.from_filter ||
    from.toLowerCase().includes(rule.from_filter.toLowerCase())
  const subjectMatch = !rule.subject_filter ||
    subject.toLowerCase().includes(rule.subject_filter.toLowerCase())
  return fromMatch && subjectMatch
}

async function sendForward(match, recipients) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: recipients,
    replyTo: match.from,
    subject: `[Local Test Fwd] ${match.subject}`,
    headers: {
      'X-Forwarded-From': match.from,
      'X-Forwarded-By': 'MailRelay Local Test',
      'X-Original-Subject': match.subject,
    },
    html: `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
        <div style="background:#4B6BF1;padding:12px 20px;border-radius:8px 8px 0 0">
          <span style="color:white;font-weight:bold;font-size:15px">MailRelay</span>
          <span style="color:#c7d2fe;font-size:13px;margin-left:8px">Local Test Forward</span>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;background:#f9fafb">
            <tr><td style="color:#6b7280;padding:4px 8px;width:80px">From</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(match.from)}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 8px">Subject</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(match.subject)}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 8px">Via rule</td><td style="color:#4B6BF1;padding:4px 8px">${escapeHtml(match.rule.name)}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 8px">To</td><td style="color:#111827;padding:4px 8px">${recipients.map(escapeHtml).join(', ')}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
          <div style="font-size:14px;color:#374151;line-height:1.6">
            ${match.bodyContent}
          </div>
        </div>
      </div>
    `,
  })
}

function decrypt(encrypted) {
  const [ivHex, tagHex, dataHex] = encrypted.split(':')
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

function getKey() {
  return scryptSync(process.env.ENCRYPTION_SECRET, 'mailrelay', 32)
}

function getBestBody(raw, depth = 0) {
  if (!raw || depth > 5) return { html: '', text: '' }

  const crlfIdx = raw.indexOf('\r\n\r\n')
  const lfIdx = raw.indexOf('\n\n')
  const headerEnd = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
  const topHeaders = raw.slice(0, headerEnd)
  const topBody = raw.slice(headerEnd)
  const topEnc = (topHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

  let decodedBody = topBody
  if (topEnc === 'quoted-printable') {
    decodedBody = decodeQP(topBody)
  } else if (topEnc === 'base64') {
    try { decodedBody = Buffer.from(topBody.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  const fullDecoded = topHeaders + decodedBody
  const boundaryMatch = fullDecoded.match(/boundary=\s*"?([^"\r\n;]+)"?/i)

  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    const parts = splitMimeParts(decodedBody, boundary)

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
        htmlPart = decodeQPIfNeeded(decodeBodyPart(part))
      } else if (ct.includes('text/plain') && !textPart) {
        textPart = decodeQPIfNeeded(decodeBodyPart(part))
      }
    }

    return { html: htmlPart, text: textPart }
  }

  const topType = getHeader(topHeaders, 'content-type')
  if (topType.includes('text/html')) return { html: decodeQPIfNeeded(decodedBody.trim()), text: '' }
  return { html: '', text: decodeQPIfNeeded(decodedBody.trim()) }
}

function extractBodyContent(html) {
  if (!html) return ''

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) return bodyMatch[1].trim()

  if (/<html[\s>]/i.test(html)) {
    return html
      .replace(/^[\s\S]*?<\/head>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .trim()
  }

  return html
}

function getHeader(part, name) {
  const match = part.match(new RegExp(`(?:^|\\r?\\n)${name}:[\\s]*([^\\r\\n]+)`, 'i'))
  return match ? match[1].trim().toLowerCase() : ''
}

function splitMimeParts(body, boundary) {
  return body
    .split(new RegExp(`(?:^|\\r?\\n)--${escapeRegex(boundary)}`))
    .slice(1)
    .filter(p => !p.trimStart().startsWith('--'))
}

function decodeBodyPart(part) {
  const crlfIdx = part.indexOf('\r\n\r\n')
  const lfIdx = part.indexOf('\n\n')
  const bodyStart = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
  const headers = part.slice(0, bodyStart)
  const body = part.slice(bodyStart).trim()

  const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

  if (enc === 'quoted-printable') return decodeQP(body)
  if (enc === 'base64') {
    try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  return body
}

function decodeQP(input) {
  let result = input.replace(/=\r\n/g, '').replace(/=\n/g, '')
  result = result.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  )

  try {
    result = Buffer.from(result, 'latin1').toString('utf8')
  } catch {}

  return result
}

function decodeQPIfNeeded(input) {
  if (!looksQuotedPrintable(input)) return input
  return decodeQP(input)
}

function looksQuotedPrintable(input) {
  const matches = input.match(/=(?:\r?\n|[0-9A-Fa-f]{2})/g)
  return (matches?.length ?? 0) >= 3 || /<[^>]+=\r?\n|<[^>]+=3D/i.test(input)
}

function loadEnvFile(file) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue

    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] ??= value
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue

    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2)
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue
      continue
    }

    const next = argv[i + 1]

    if (!next || next.startsWith('--')) {
      parsed[key] = true
    } else {
      parsed[key] = next
      i += 1
    }
  }

  const npmFallbacks = {
    account: 'npm_config_account',
    from: 'npm_config_from',
    subject: 'npm_config_subject',
    'since-minutes': 'npm_config_since_minutes',
    limit: 'npm_config_limit',
    to: 'npm_config_to',
  }

  for (const [key, envName] of Object.entries(npmFallbacks)) {
    if (parsed[key] === undefined && process.env[envName]) {
      parsed[key] = process.env[envName]
    }
  }

  if (parsed.send === undefined && process.env.npm_config_send === 'true') {
    parsed.send = true
  }

  if (parsed['ignore-dedupe'] === undefined && process.env.npm_config_ignore_dedupe === 'true') {
    parsed['ignore-dedupe'] = true
  }

  if (parsed['list-accounts'] === undefined && process.env.npm_config_list_accounts === 'true') {
    parsed['list-accounts'] = true
  }

  if (parsed['show-artifacts'] === undefined && process.env.npm_config_show_artifacts === 'true') {
    parsed['show-artifacts'] = true
  }

  return parsed
}

function printHelp() {
  console.log(`
Usage:
  npm run test:poll-real -- --account <gmail> [options]

Options:
  --account <email-or-id>       Required Gmail account row to poll
  --from <text>                 Override DB rules with a sender filter
  --subject <text>              Override DB rules with a subject filter
  --since-minutes <number>      Search window, default 1440
  --limit <number>              Max messages per folder, default 25
  --ignore-dedupe               Ignore forwarded_log dedupe for testing
  --to <email>                  Test recipient, required with --send
  --send                        Actually send the matched message(s)
  --list-accounts               Print gmail_accounts rows and exit
  --show-artifacts              Print short contexts for =3D or =20 markers

Examples:
  npm run test:poll-real -- --list-accounts
  npm run test:poll-real -- --account btcmaster657@gmail.com --from outlier.ai --subject "Activation Link"
  npm run test:poll-real -- --account btcmaster657@gmail.com --from outlier.ai --to you@example.com --send
`)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
