// // import { ImapFlow } from 'imapflow'
// // import { decrypt } from './crypto'
// // import { transporter } from './email'

// // export interface GmailAccount {
// //   id: string
// //   email: string
// //   app_password_encrypted: string
// // }

// // export interface Rule {
// //   id: string
// //   name: string
// //   from_filter: string | null
// //   subject_filter: string | null
// //   recipients: string[]
// // }

// // export interface ForwardResult {
// //   subject: string
// //   from: string
// //   ruleName: string
// //   recipients: string[]
// //   messageId: string
// // }

// // /**
// //  * Connect to Gmail IMAP, fetch all messages since `sinceDate`,
// //  * match against rules, forward matches via SMTP.
// //  *
// //  * Uses INTERNALDATE (server receive time) not the Seen flag —
// //  * so it works even if the user has already read the email in Gmail.
// //  *
// //  * Deduplication is handled by the caller via already-forwarded Message-IDs
// //  * stored in the database (passed in as `alreadyForwarded`).
// //  */
// // export async function pollAndForward(
// //   account: GmailAccount,
// //   rules: Rule[],
// //   sinceDate: Date,
// //   alreadyForwarded: Set<string>
// // ): Promise<ForwardResult[]> {
// //   const password = decrypt(account.app_password_encrypted)

// //   const client = new ImapFlow({
// //     host: 'imap.gmail.com',
// //     port: 993,
// //     secure: true,
// //     auth: { user: account.email, pass: password },
// //     logger: false,
// //     socketTimeout: 4000,
// //     greetingTimeout: 4000,
// //   })

// //   await client.connect()
// //   const results: ForwardResult[] = []

// //   // Poll INBOX and Spam only — never All Mail (contains sent items which causes loops)
// //   const folders = ['INBOX', '[Gmail]/Spam']
// //   // Max emails to process per folder per cycle — prevents timeout on large inboxes
// //   const BATCH_SIZE = 25

// //   try {
// //     for (const folder of folders) {
// //       let lock
// //       try { lock = await client.getMailboxLock(folder) } catch { continue }

// //       try {
// //         const uids = await client.search({ since: sinceDate }, { uid: true })
// //         const uidList = Array.isArray(uids) ? uids : []
// //         if (!uidList.length) continue

// //         // Take only the NEWEST batch — UIDs are ascending so slice from end
// //         const batchUids = uidList.slice(-BATCH_SIZE)

// //         const messages = client.fetch(batchUids, { envelope: true, source: true }, { uid: true })

// //         for await (const msg of messages) {
// //           const subject = msg.envelope?.subject || ''
// //           const from = msg.envelope?.from?.[0]?.address || ''
// //           const messageId = msg.envelope?.messageId || `uid-${msg.uid}`

// //           if (alreadyForwarded.has(messageId)) continue

// //           // Skip emails sent BY this account (our own forwarded copies)
// //           if (from.toLowerCase() === account.email.toLowerCase()) continue

// //           for (const rule of rules) {
// //             const fromMatch = !rule.from_filter ||
// //               from.toLowerCase().includes(rule.from_filter.toLowerCase())
// //             const subjectMatch = !rule.subject_filter ||
// //               subject.toLowerCase().includes(rule.subject_filter.toLowerCase())

// //             if (fromMatch && subjectMatch && rule.recipients.length > 0) {
// //               const raw = msg.source?.toString() ?? ''

// //               // Decode the full raw source first, then extract body
// //               // This ensures QP/base64 headers are always with their content
// //               const { html: bodyHtml, text: bodyText } = getBestBody(raw)

// //               // Ensure we have clean, UTF-8 content
// //               // Remove any remaining QP artifacts if present (shouldn't be, but defensive)
// //               const cleanHtml = bodyHtml ? bodyHtml.replace(/=\r\n/g, '').replace(/=\n/g, '') : ''
// //               const cleanText = bodyText ? bodyText.replace(/=\r\n/g, '').replace(/=\n/g, '') : ''

// //               // bodyHtml is already decoded HTML — inject directly, never escape
// //               // bodyText is decoded plain text — escape then wrap in pre
// //               const bodyContent = cleanHtml
// //                 ? cleanHtml
// //                 : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(cleanText)}</pre>`

// //               await transporter.sendMail({
// //                 from: `MailRelay <${process.env.SMTP_USER}>`,
// //                 to: rule.recipients,
// //                 replyTo: from,
// //                 subject: `[Fwd] ${subject}`,
// //                 headers: {
// //                   'X-Forwarded-From': from,
// //                   'X-Forwarded-By': 'MailRelay',
// //                   'X-Original-Subject': subject,
// //                   // Prevent SMTP from re-encoding with quoted-printable
// //                   'Content-Transfer-Encoding': '8bit',
// //                 },
// //                 html: `
// //                   <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
// //                     <div style="background:#4B6BF1;padding:12px 20px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
// //                       <div>
// //                         <span style="color:white;font-weight:bold;font-size:15px">MailRelay</span>
// //                         <span style="color:#c7d2fe;font-size:13px;margin-left:8px">Forwarded Email</span>
// //                       </div>
// //                       <a href="mailto:${from}" style="color:#c7d2fe;font-size:12px;text-decoration:none;border:1px solid rgba(255,255,255,0.3);padding:4px 10px;border-radius:6px">Reply to sender</a>
// //                     </div>
// //                     <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px">
// //                       <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;background:#f9fafb;border-radius:8px;padding:12px">
// //                         <tr><td style="color:#6b7280;padding:4px 8px;width:80px">From</td><td style="color:#111827;font-weight:600;padding:4px 8px">${from}</td></tr>
// //                         <tr><td style="color:#6b7280;padding:4px 8px">Subject</td><td style="color:#111827;font-weight:600;padding:4px 8px">${subject}</td></tr>
// //                         <tr><td style="color:#6b7280;padding:4px 8px">Via rule</td><td style="color:#4B6BF1;padding:4px 8px">${rule.name}</td></tr>
// //                         <tr><td style="color:#6b7280;padding:4px 8px">To</td><td style="color:#111827;padding:4px 8px">${rule.recipients.join(', ')}</td></tr>
// //                       </table>
// //                       <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
// //                       <div style="font-size:14px;color:#374151;line-height:1.6">
// //                         ${bodyContent}
// //                       </div>
// //                     </div>
// //                     <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:12px">
// //                       Forwarded by <a href="https://mailrelay-jet.vercel.app" style="color:#9ca3af">MailRelay</a> &middot; <a href="mailto:${from}" style="color:#9ca3af">Reply to ${from}</a>
// //                     </p>
// //                   </div>
// //                 `,
// //                 attachments: [],
// //               })

// //               results.push({ subject, from, ruleName: rule.name, recipients: rule.recipients, messageId })
// //               alreadyForwarded.add(messageId)
// //               break
// //             }
// //           }
// //         }
// //       } finally {
// //         lock.release()
// //       }
// //     }
// //   } finally {
// //     try { await client.logout() } catch {}
// //   }

// //   return results
// // }

// // // Keep old export name for any other callers
// // export const idleAndForward = pollAndForward

// // // ---------------------------------------------------------------------------
// // // Body extraction helpers
// // // ---------------------------------------------------------------------------

// // /**
// //  * Fully decode a raw RFC 2822 email source and return the best body:
// //  * prefers text/html, falls back to text/plain.
// //  * Handles multipart/alternative, multipart/mixed, and single-part.
// //  */
// // function getBestBody(raw: string, depth = 0): { html: string; text: string } {
// //   if (!raw || depth > 5) return { html: '', text: '' }

// //   const boundaryMatch = raw.match(/boundary=\s*"?([^"\r\n;]+)"?/i)

// //   if (boundaryMatch) {
// //     const boundary = boundaryMatch[1].trim()
// //     // Split on --boundary lines, filter out empty parts and the closing --boundary--
// //     const parts = raw
// //       .split(new RegExp(`\r?\n--${escapeRegex(boundary)}`))
// //       .slice(1) // first element is the preamble before first boundary
// //       .filter(p => !p.startsWith('--')) // remove closing boundary

// //     let htmlPart = ''
// //     let textPart = ''

// //     for (const part of parts) {
// //       const ct = getHeader(part, 'content-type')
// //       if (!ct) continue

// //       // Only recurse if this part itself has a boundary (truly nested multipart)
// //       if (ct.includes('multipart/') && /boundary=/i.test(part)) {
// //         const nested = getBestBody(part, depth + 1)
// //         if (nested.html && !htmlPart) htmlPart = nested.html
// //         if (nested.text && !textPart) textPart = nested.text
// //         continue
// //       }

// //       if (ct.includes('text/html') && !htmlPart) {
// //         htmlPart = decodeBodyPart(part)
// //       } else if (ct.includes('text/plain') && !textPart) {
// //         textPart = decodeBodyPart(part)
// //       }
// //     }

// //     return { html: htmlPart, text: textPart }
// //   }

// //   // Single-part
// //   const topType = getHeader(raw, 'content-type')
// //   if (topType.includes('text/html')) {
// //     return { html: decodeBodyPart(raw), text: '' }
// //   }
// //   return { html: '', text: decodeBodyPart(raw) }
// // }

// // /** Extract a header value from a part string */
// // function getHeader(part: string, name: string): string {
// //   // Use \b word boundary and no ^ anchor — part may start with \r\n after boundary split
// //   const match = part.match(new RegExp(`(?:^|\r?\n)${name}:\s*([^\r\n]+)`, 'i'))
// //   return match ? match[1].trim().toLowerCase() : ''
// // }

// // /** Decode a single MIME part — strips headers, decodes QP or base64 */
// // function decodeBodyPart(part: string): string {
// //   // Find blank line separating headers from body
// //   const crlfIdx = part.indexOf('\r\n\r\n')
// //   const lfIdx = part.indexOf('\n\n')
// //   const bodyStart = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
// //   const headers = part.slice(0, bodyStart)
// //   let body = part.slice(bodyStart).trim()

// //   const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()
// //   const charset = (headers.match(/charset\s*=\s*["']?([^"'\s;]+)/i)?.[1] ?? 'utf-8').toLowerCase()

// //   if (enc === 'quoted-printable') {
// //     // First: remove soft line breaks (=\r\n or =\n)
// //     body = body.replace(/=\r\n/g, '').replace(/=\n/g, '')
    
// //     // Second: decode QP sequences (=XX where XX is hex)
// //     // This creates a binary/latin1 string that represents the encoded bytes
// //     body = body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    
// //     // Third: convert from the original charset to UTF-8 string
// //     // QP-encoded data is usually latin1/ISO-8859-1 bytes, so we need to convert
// //     if (charset !== 'utf-8') {
// //       try { body = Buffer.from(body, 'latin1').toString('utf8') } catch {}
// //     } else {
// //       // Even for UTF-8, we decoded as chars above, so convert to proper UTF-8
// //       try { body = Buffer.from(body, 'latin1').toString('utf8') } catch {}
// //     }
// //   } else if (enc === 'base64') {
// //     try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
// //   }

// //   return body
// // }

// // // Keep old names for backward compat
// // function extractPlainBody(raw: string): string { return getBestBody(raw).text }
// // function extractHtmlBody(raw: string): string { return getBestBody(raw).html }

// // function escapeRegex(s: string): string {
// //   return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// // }

// // function escapeHtml(s: string): string {
// //   return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// // }

// import { ImapFlow } from 'imapflow'
// import { decrypt } from './crypto'
// import { transporter } from './email'

// export interface GmailAccount {
//   id: string
//   email: string
//   app_password_encrypted: string
// }

// export interface Rule {
//   id: string
//   name: string
//   from_filter: string | null
//   subject_filter: string | null
//   recipients: string[]
// }

// export interface ForwardResult {
//   subject: string
//   from: string
//   ruleName: string
//   recipients: string[]
//   messageId: string
// }

// /**
//  * Connect to Gmail IMAP, fetch all messages since `sinceDate`,
//  * match against rules, forward matches via SMTP.
//  */
// export async function pollAndForward(
//   account: GmailAccount,
//   rules: Rule[],
//   sinceDate: Date,
//   alreadyForwarded: Set<string>
// ): Promise<ForwardResult[]> {
//   const password = decrypt(account.app_password_encrypted)

//   const client = new ImapFlow({
//     host: 'imap.gmail.com',
//     port: 993,
//     secure: true,
//     auth: { user: account.email, pass: password },
//     logger: false,
//     socketTimeout: 4000,
//     greetingTimeout: 4000,
//   })

//   await client.connect()
//   const results: ForwardResult[] = []

//   const folders = ['INBOX', '[Gmail]/Spam']
//   const BATCH_SIZE = 25

//   try {
//     for (const folder of folders) {
//       let lock
//       try { lock = await client.getMailboxLock(folder) } catch { continue }

//       try {
//         const uids = await client.search({ since: sinceDate }, { uid: true })
//         const uidList = Array.isArray(uids) ? uids : []
//         if (!uidList.length) continue

//         const batchUids = uidList.slice(-BATCH_SIZE)
//         const messages = client.fetch(batchUids, { envelope: true, source: true }, { uid: true })

//         for await (const msg of messages) {
//           const subject = msg.envelope?.subject || ''
//           const from = msg.envelope?.from?.[0]?.address || ''
//           const messageId = msg.envelope?.messageId || `uid-${msg.uid}`

//           if (alreadyForwarded.has(messageId)) continue
//           if (from.toLowerCase() === account.email.toLowerCase()) continue

//           for (const rule of rules) {
//             const fromMatch = !rule.from_filter ||
//               from.toLowerCase().includes(rule.from_filter.toLowerCase())
//             const subjectMatch = !rule.subject_filter ||
//               subject.toLowerCase().includes(rule.subject_filter.toLowerCase())

//             if (fromMatch && subjectMatch && rule.recipients.length > 0) {
//               const raw = msg.source?.toString() ?? ''

//               const { html: bodyHtml, text: bodyText } = getBestBody(raw)

//               // Extract only the <body> contents if it's a full HTML document
//               const safeHtml = bodyHtml ? extractBodyContent(bodyHtml) : ''

//               const bodyContent = safeHtml
//                 ? safeHtml
//                 : bodyText
//                   ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(bodyText)}</pre>`
//                   : '<p style="color:#6b7280">(No message body)</p>'

//               await transporter.sendMail({
//                 from: `MailRelay <${process.env.SMTP_USER}>`,
//                 to: rule.recipients,
//                 replyTo: from,
//                 subject: `[Fwd] ${subject}`,
//                 headers: {
//                   'X-Forwarded-From': from,
//                   'X-Forwarded-By': 'MailRelay',
//                   'X-Original-Subject': subject,
//                 },
//                 html: `
//                   <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
//                     <div style="background:#4B6BF1;padding:12px 20px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
//                       <div>
//                         <span style="color:white;font-weight:bold;font-size:15px">MailRelay</span>
//                         <span style="color:#c7d2fe;font-size:13px;margin-left:8px">Forwarded Email</span>
//                       </div>
//                       <a href="mailto:${from}" style="color:#c7d2fe;font-size:12px;text-decoration:none;border:1px solid rgba(255,255,255,0.3);padding:4px 10px;border-radius:6px">Reply to sender</a>
//                     </div>
//                     <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px">
//                       <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;background:#f9fafb;border-radius:8px;padding:12px">
//                         <tr><td style="color:#6b7280;padding:4px 8px;width:80px">From</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(from)}</td></tr>
//                         <tr><td style="color:#6b7280;padding:4px 8px">Subject</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(subject)}</td></tr>
//                         <tr><td style="color:#6b7280;padding:4px 8px">Via rule</td><td style="color:#4B6BF1;padding:4px 8px">${escapeHtml(rule.name)}</td></tr>
//                         <tr><td style="color:#6b7280;padding:4px 8px">To</td><td style="color:#111827;padding:4px 8px">${rule.recipients.map(escapeHtml).join(', ')}</td></tr>
//                       </table>
//                       <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
//                       <div style="font-size:14px;color:#374151;line-height:1.6">
//                         ${bodyContent}
//                       </div>
//                     </div>
//                     <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:12px">
//                       Forwarded by <a href="https://mailrelay-jet.vercel.app" style="color:#9ca3af">MailRelay</a> &middot; <a href="mailto:${from}" style="color:#9ca3af">Reply to ${escapeHtml(from)}</a>
//                     </p>
//                   </div>
//                 `,
//                 attachments: [],
//               })

//               results.push({ subject, from, ruleName: rule.name, recipients: rule.recipients, messageId })
//               alreadyForwarded.add(messageId)
//               break
//             }
//           }
//         }
//       } finally {
//         lock.release()
//       }
//     }
//   } finally {
//     try { await client.logout() } catch {}
//   }

//   return results
// }

// export const idleAndForward = pollAndForward

// // ---------------------------------------------------------------------------
// // Body extraction helpers
// // ---------------------------------------------------------------------------

// /**
//  * Fully decode a raw RFC 2822 email and return the best body.
//  * Prefers text/html, falls back to text/plain.
//  *
//  * Key fix: decodes the ENTIRE raw source for top-level QP/base64 before
//  * trying to split on MIME boundaries. This handles the common case where
//  * the whole message body is QP-encoded (not just individual parts).
//  */
// function getBestBody(raw: string, depth = 0): { html: string; text: string } {
//   if (!raw || depth > 5) return { html: '', text: '' }

//   // Split headers from body at the first blank line
//   const crlfIdx = raw.indexOf('\r\n\r\n')
//   const lfIdx = raw.indexOf('\n\n')
//   const headerEnd = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
//   const topHeaders = raw.slice(0, headerEnd)
//   const topBody = raw.slice(headerEnd)

//   // Get top-level transfer encoding
//   const topEnc = (topHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

//   // Decode the top-level body if it's encoded
//   // This is critical: many emails QP-encode the entire body including MIME boundaries
//   let decodedBody = topBody
//   if (topEnc === 'quoted-printable') {
//     decodedBody = decodeQP(topBody)
//   } else if (topEnc === 'base64') {
//     try { decodedBody = Buffer.from(topBody.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
//   }

//   // Now work with topHeaders + decodedBody as the source for boundary splitting
//   const fullDecoded = topHeaders + decodedBody

//   const boundaryMatch = fullDecoded.match(/boundary=\s*"?([^"\r\n;]+)"?/i)

//   if (boundaryMatch) {
//     const boundary = boundaryMatch[1].trim()
//     const parts = decodedBody
//       .split(new RegExp(`\r?\n--${escapeRegex(boundary)}`))
//       .slice(1)
//       .filter(p => !p.trimStart().startsWith('--'))

//     let htmlPart = ''
//     let textPart = ''

//     for (const part of parts) {
//       const ct = getHeader(part, 'content-type')
//       if (!ct) continue

//       // Recurse only for truly nested multipart parts
//       if (ct.includes('multipart/') && /boundary=/i.test(part)) {
//         const nested = getBestBody(part, depth + 1)
//         if (nested.html && !htmlPart) htmlPart = nested.html
//         if (nested.text && !textPart) textPart = nested.text
//         continue
//       }

//       if (ct.includes('text/html') && !htmlPart) {
//         htmlPart = decodeBodyPart(part)
//       } else if (ct.includes('text/plain') && !textPart) {
//         textPart = decodeBodyPart(part)
//       }
//     }

//     return { html: htmlPart, text: textPart }
//   }

//   // Single-part — the decoded body IS the content
//   const topType = getHeader(topHeaders, 'content-type')
//   if (topType.includes('text/html')) {
//     return { html: decodedBody.trim(), text: '' }
//   }
//   return { html: '', text: decodedBody.trim() }
// }

// /**
//  * If the HTML string is a full document, extract only the <body> inner HTML.
//  * This prevents nested <html>/<body> tags from breaking email client rendering.
//  */
// function extractBodyContent(html: string): string {
//   if (!html) return ''

//   // Extract <body ...>...</body> contents
//   const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
//   if (bodyMatch) {
//     return bodyMatch[1].trim()
//   }

//   // Has <html> tag but no explicit <body> — strip html/head tags
//   if (/<html[\s>]/i.test(html)) {
//     return html
//       .replace(/^[\s\S]*?<\/head>/i, '')
//       .replace(/<\/?html[^>]*>/gi, '')
//       .trim()
//   }

//   // Not a full document — return as-is
//   return html
// }

// /** Extract a header value from a part string */
// function getHeader(part: string, name: string): string {
//   const match = part.match(new RegExp(`(?:^|\r?\n)${name}:[\\s]*([^\r\n]+)`, 'i'))
//   return match ? match[1].trim().toLowerCase() : ''
// }

// /**
//  * Decode quoted-printable encoding.
//  * Handles soft line breaks (=\r\n, =\n) and hex sequences (=XX).
//  */
// function decodeQP(input: string, charset = 'utf-8'): string {
//   // Step 1: remove soft line breaks
//   let result = input.replace(/=\r\n/g, '').replace(/=\n/g, '')

//   // Step 2: decode hex sequences into bytes stored as latin1 chars
//   result = result.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
//     String.fromCharCode(parseInt(hex, 16))
//   )

//   // Step 3: re-interpret the latin1 byte string as the actual charset
//   try {
//     result = Buffer.from(result, 'latin1').toString('utf8')
//   } catch {}

//   return result
// }

// /** Decode a single MIME part — strips headers, decodes QP or base64 */
// function decodeBodyPart(part: string): string {
//   const crlfIdx = part.indexOf('\r\n\r\n')
//   const lfIdx = part.indexOf('\n\n')
//   const bodyStart = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
//   const headers = part.slice(0, bodyStart)
//   const body = part.slice(bodyStart).trim()

//   const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

//   if (enc === 'quoted-printable') {
//     return decodeQP(body)
//   } else if (enc === 'base64') {
//     try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
//   }

//   return body
// }

// function escapeRegex(s: string): string {
//   return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// }

// function escapeHtml(s: string): string {
//   return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// }
import { ImapFlow } from 'imapflow'
import { decrypt } from './crypto'
import { getTransporter } from './email'
import { lookup as dnsLookup, promises as dns } from 'dns'

export interface GmailAccount {
  id: string
  email: string
  app_password_encrypted: string
}

export interface Rule {
  id: string
  name: string
  from_filter: string | null
  subject_filter: string | null
  recipients: string[]
}

export interface ForwardResult {
  subject: string
  from: string
  ruleName: string
  recipients: string[]
  messageId: string
}

const IMAP_CONNECTION_TIMEOUT = Number(process.env.IMAP_CONNECTION_TIMEOUT_MS ?? 10000)
const IMAP_GREETING_TIMEOUT = Number(process.env.IMAP_GREETING_TIMEOUT_MS ?? 10000)
const IMAP_SOCKET_TIMEOUT = Number(process.env.IMAP_SOCKET_TIMEOUT_MS ?? 20000)
const IMAP_MAX_HOST_ATTEMPTS = Number(process.env.IMAP_MAX_HOST_ATTEMPTS ?? 2)

/**
 * Connect to Gmail IMAP, fetch all messages since `sinceDate`,
 * match against rules, forward matches via SMTP.
 */
export async function pollAndForward(
  account: GmailAccount,
  rules: Rule[],
  sinceDate: Date,
  alreadyForwarded: Set<string>
): Promise<ForwardResult[]> {
  const password = decrypt(account.app_password_encrypted)

  const client = await connectGmailImap(account.email, password)
  const results: ForwardResult[] = []

  const folders = ['INBOX', '[Gmail]/Spam']
  const BATCH_SIZE = 25

  try {
    for (const folder of folders) {
      let lock
      try { lock = await client.getMailboxLock(folder) } catch { continue }

      try {
        const uids = await client.search({ since: sinceDate }, { uid: true })
        const uidList = Array.isArray(uids) ? uids : []
        if (!uidList.length) continue

        const batchUids = uidList.slice(-BATCH_SIZE)
        const messages = client.fetch(batchUids, { envelope: true, source: true }, { uid: true })

        for await (const msg of messages) {
          const subject = msg.envelope?.subject || ''
          const from = msg.envelope?.from?.[0]?.address || ''
          const messageId = msg.envelope?.messageId || `uid-${msg.uid}`

          if (alreadyForwarded.has(messageId)) continue
          if (from.toLowerCase() === account.email.toLowerCase()) continue

          for (const rule of rules) {
            const fromMatch = !rule.from_filter ||
              from.toLowerCase().includes(rule.from_filter.toLowerCase())
            const subjectMatch = !rule.subject_filter ||
              subject.toLowerCase().includes(rule.subject_filter.toLowerCase())

            if (fromMatch && subjectMatch && rule.recipients.length > 0) {
              const raw = msg.source?.toString() ?? ''

              const { html: bodyHtml, text: bodyText } = getBestBody(raw)

              // Extract only the <body> contents if it's a full HTML document
              const safeHtml = bodyHtml ? extractBodyContent(bodyHtml) : ''

              const bodyContent = safeHtml
                ? safeHtml
                : bodyText
                  ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(bodyText)}</pre>`
                  : '<p style="color:#6b7280">(No message body)</p>'

              const transporter = await getTransporter()
              await transporter.sendMail({
                from: `MailRelay <${process.env.SMTP_USER}>`,
                to: rule.recipients,
                replyTo: from,
                subject: `[Fwd] ${subject}`,
                headers: {
                  'X-Forwarded-From': from,
                  'X-Forwarded-By': 'MailRelay',
                  'X-Original-Subject': subject,
                },
                html: `
                  <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
                    <div style="background:#4B6BF1;padding:12px 20px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
                      <div>
                        <span style="color:white;font-weight:bold;font-size:15px">MailRelay</span>
                        <span style="color:#c7d2fe;font-size:13px;margin-left:8px">Forwarded Email</span>
                      </div>
                      <a href="mailto:${from}" style="color:#c7d2fe;font-size:12px;text-decoration:none;border:1px solid rgba(255,255,255,0.3);padding:4px 10px;border-radius:6px">Reply to sender</a>
                    </div>
                    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px">
                      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;background:#f9fafb;border-radius:8px;padding:12px">
                        <tr><td style="color:#6b7280;padding:4px 8px;width:80px">From</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(from)}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">Subject</td><td style="color:#111827;font-weight:600;padding:4px 8px">${escapeHtml(subject)}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">Via rule</td><td style="color:#4B6BF1;padding:4px 8px">${escapeHtml(rule.name)}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">To</td><td style="color:#111827;padding:4px 8px">${rule.recipients.map(escapeHtml).join(', ')}</td></tr>
                      </table>
                      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
                      <div style="font-size:14px;color:#374151;line-height:1.6">
                        ${bodyContent}
                      </div>
                    </div>
                    <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:12px">
                      Forwarded by <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="color:#9ca3af">MailRelay</a> &middot; <a href="mailto:${from}" style="color:#9ca3af">Reply to ${escapeHtml(from)}</a>
                    </p>
                  </div>
                `,
                attachments: [],
              })

              results.push({ subject, from, ruleName: rule.name, recipients: rule.recipients, messageId })
              alreadyForwarded.add(messageId)
              break
            }
          }
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

async function connectGmailImap(email: string, password: string): Promise<ImapFlow> {
  const hosts = (await getGmailImapHosts()).slice(0, Math.max(1, IMAP_MAX_HOST_ATTEMPTS))
  const errors: string[] = []
  let lastError: unknown

  for (const host of hosts) {
    const client = createGmailClient(host, email, password)
    try {
      await client.connect()
      return client
    } catch (err: unknown) {
      lastError = err
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`)
      try { await client.close() } catch {}
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'Could not connect to Gmail IMAP')
  throw new Error(`${message}; attempts: ${errors.join(' | ')}`)
}

async function getGmailImapHosts() {
  const hosts = ['imap.gmail.com']
  try {
    const addrs = await dns.resolve4('imap.gmail.com')
    return [...new Set([...hosts, ...addrs])]
  } catch {}

  return hosts
}

function createGmailClient(host: string, email: string, password: string) {
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT,
    greetingTimeout: IMAP_GREETING_TIMEOUT,
    socketTimeout: IMAP_SOCKET_TIMEOUT,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      servername: 'imap.gmail.com',
      lookup: (hostname, _options, callback) => dnsLookup(hostname, { family: 4 }, callback),
    },
  })

  // Prevent uncaught IMAP socket errors from crashing the process
  client.on('error', () => {})

  return client
}

export const idleAndForward = pollAndForward

// ---------------------------------------------------------------------------
// Body extraction helpers
// ---------------------------------------------------------------------------

/**
 * Fully decode a raw RFC 2822 email and return the best body.
 * Prefers text/html, falls back to text/plain.
 *
 * Key fix: decodes the ENTIRE raw source for top-level QP/base64 before
 * trying to split on MIME boundaries. This handles the common case where
 * the whole message body is QP-encoded (not just individual parts).
 */
function getBestBody(raw: string, depth = 0): { html: string; text: string } {
  if (!raw || depth > 5) return { html: '', text: '' }

  // Split headers from body at the first blank line
  const crlfIdx = raw.indexOf('\r\n\r\n')
  const lfIdx = raw.indexOf('\n\n')
  const headerEnd = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
  const topHeaders = raw.slice(0, headerEnd)
  const topBody = raw.slice(headerEnd)

  // Get top-level transfer encoding
  const topEnc = (topHeaders.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

  // Decode the top-level body if it's encoded
  // This is critical: many emails QP-encode the entire body including MIME boundaries
  let decodedBody = topBody
  if (topEnc === 'quoted-printable') {
    decodedBody = decodeQP(topBody)
  } else if (topEnc === 'base64') {
    try { decodedBody = Buffer.from(topBody.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  // Now work with topHeaders + decodedBody as the source for boundary splitting
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

      // Recurse only for truly nested multipart parts
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

  // Single-part — the decoded body IS the content
  const topType = getHeader(topHeaders, 'content-type')
  if (topType.includes('text/html')) {
    return { html: decodeQPIfNeeded(decodedBody.trim()), text: '' }
  }
  return { html: '', text: decodeQPIfNeeded(decodedBody.trim()) }
}

/**
 * If the HTML string is a full document, extract only the <body> inner HTML.
 * This prevents nested <html>/<body> tags from breaking email client rendering.
 */
function extractBodyContent(html: string): string {
  if (!html) return ''

  // Extract <body ...>...</body> contents
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    return bodyMatch[1].trim()
  }

  // Has <html> tag but no explicit <body> — strip html/head tags
  if (/<html[\s>]/i.test(html)) {
    return html
      .replace(/^[\s\S]*?<\/head>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .trim()
  }

  // Not a full document — return as-is
  return html
}

/** Extract a header value from a part string */
function getHeader(part: string, name: string): string {
  const match = part.match(new RegExp(`(?:^|\r?\n)${name}:[\\s]*([^\r\n]+)`, 'i'))
  return match ? match[1].trim().toLowerCase() : ''
}

function splitMimeParts(body: string, boundary: string): string[] {
  return body
    .split(new RegExp(`(?:^|\r?\n)--${escapeRegex(boundary)}`))
    .slice(1)
    .filter(p => !p.trimStart().startsWith('--'))
}

/**
 * Decode quoted-printable encoding.
 * Handles soft line breaks (=\r\n, =\n) and hex sequences (=XX).
 */
function decodeQP(input: string): string {
  // Step 1: remove soft line breaks
  let result = input.replace(/=\r\n/g, '').replace(/=\n/g, '')

  // Step 2: decode hex sequences into bytes stored as latin1 chars
  result = result.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  )

  // Step 3: re-interpret the latin1 byte string as the actual charset
  try {
    result = Buffer.from(result, 'latin1').toString('utf8')
  } catch {}

  return result
}

function decodeQPIfNeeded(input: string): string {
  if (!looksQuotedPrintable(input)) return input
  return decodeQP(input)
}

function looksQuotedPrintable(input: string): boolean {
  const matches = input.match(/=(?:\r?\n|[0-9A-Fa-f]{2})/g)
  return (matches?.length ?? 0) >= 3 || /<[^>]+=\r?\n|<[^>]+=3D/i.test(input)
}

/** Decode a single MIME part — strips headers, decodes QP or base64 */
function decodeBodyPart(part: string): string {
  const crlfIdx = part.indexOf('\r\n\r\n')
  const lfIdx = part.indexOf('\n\n')
  const bodyStart = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0
  const headers = part.slice(0, bodyStart)
  const body = part.slice(bodyStart).trim()

  const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i)?.[1] ?? '').trim().toLowerCase()

  if (enc === 'quoted-printable') {
    return decodeQP(body)
  } else if (enc === 'base64') {
    try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  return body
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
