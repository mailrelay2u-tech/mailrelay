type MailAddressInput = string | string[]

interface MailOptions {
  from?: string
  to: MailAddressInput
  replyTo?: string
  subject: string
  headers?: Record<string, string>
  html?: string
  text?: string
  attachments?: unknown[]
}

interface BrevoAddress {
  email: string
  name?: string
}

interface BrevoPayload {
  sender: BrevoAddress
  to: BrevoAddress[]
  replyTo?: BrevoAddress
  subject: string
  htmlContent?: string
  textContent?: string
  headers?: Record<string, string>
}

export async function getTransporter() {
  return {
    sendMail: sendTransactionalEmail,
  }
}

export async function sendTransactionalEmail(options: MailOptions) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Missing environment variable: BREVO_API_KEY')

  const payload = buildBrevoPayload(options)
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Brevo send failed (${response.status}): ${errorBody.slice(0, 500)}`)
  }

  return response.json().catch(() => ({}))
}

export function getDefaultFrom() {
  const sender = getDefaultSender()
  return sender.name ? `${sender.name} <${sender.email}>` : sender.email
}

function buildBrevoPayload(options: MailOptions): BrevoPayload {
  const sender = parseAddress(options.from) ?? getDefaultSender()
  const to = parseAddressList(options.to)
  if (!to.length) throw new Error('Missing email recipient')

  const payload: BrevoPayload = {
    sender,
    to,
    subject: options.subject,
  }

  if (options.replyTo) payload.replyTo = parseAddress(options.replyTo) ?? { email: options.replyTo }
  if (options.html) payload.htmlContent = options.html
  if (options.text) payload.textContent = options.text
  if (options.headers) payload.headers = options.headers

  if (!payload.htmlContent && !payload.textContent) {
    payload.textContent = options.subject
  }

  return payload
}

function getDefaultSender(): BrevoAddress {
  const email = process.env.BREVO_FROM_EMAIL
  if (!email) throw new Error('Missing environment variable: BREVO_FROM_EMAIL')

  return {
    email,
    name: process.env.BREVO_FROM_NAME || 'MailRelay',
  }
}

function parseAddressList(input: MailAddressInput): BrevoAddress[] {
  const values = Array.isArray(input) ? input : input.split(',')
  return values
    .map(value => parseAddress(value))
    .filter((address): address is BrevoAddress => Boolean(address))
}

function parseAddress(input: string | undefined): BrevoAddress | null {
  if (!input) return null

  const trimmed = input.trim()
  const mailbox = trimmed.match(/^(.*?)\s*<([^>]+)>$/)
  if (mailbox) {
    const name = mailbox[1].trim().replace(/^["']|["']$/g, '')
    const email = mailbox[2].trim()
    if (!email || email === 'undefined') return null
    return name ? { email, name } : { email }
  }

  if (!trimmed || trimmed === 'undefined') return null
  return { email: trimmed }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.BREVO_FROM_EMAIL || process.env.SMTP_USER

/**
 * Sends a welcome / verify-your-email notice to the new user.
 * Supabase Auth handles the actual verification link; this is just a branded welcome.
 */
export async function sendWelcomeEmail(toEmail: string, name: string) {
  await sendTransactionalEmail({
    to: toEmail,
    subject: 'Welcome to MailRelay - verify your email',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <p>Welcome to MailRelay, ${name}.</p>
        <p>Your account has been created. Check your inbox for the verification email from Supabase to confirm your address.</p>
        <p>Sign in at <a href="${APP_URL}/login">${APP_URL}/login</a>.</p>
        <p style="color:#888;font-size:12px">If you did not sign up, ignore this email.</p>
      </div>
    `,
    text: `Welcome to MailRelay, ${name}.\n\nYour account has been created. Check your inbox for the verification email from Supabase to confirm your address.\n\nSign in at ${APP_URL}/login.`,
  })
}

/**
 * Notifies the superadmin that a new user signed up.
 */
export async function sendAdminNotification(name: string, email: string) {
  if (!ADMIN_EMAIL) throw new Error('Missing environment variable: ADMIN_EMAIL')

  await sendTransactionalEmail({
    to: ADMIN_EMAIL,
    subject: `New MailRelay signup: ${name}`,
    html: `
      <p><strong>${name}</strong> (${email}) just signed up for MailRelay.</p>
      <p>View users at <a href="${APP_URL}/admin/invites">${APP_URL}/admin/invites</a></p>
    `,
    text: `${name} (${email}) just signed up for MailRelay.\n\nView users at ${APP_URL}/admin/invites`,
  })
}

/**
 * Sends the generated invite code to the admin.
 * Kept for manual invite flow if superadmin wants to invite someone directly.
 */
export async function sendInviteCodeToAdmin(requesterName: string, requesterEmail: string, code: string) {
  if (!ADMIN_EMAIL) throw new Error('Missing environment variable: ADMIN_EMAIL')

  await sendTransactionalEmail({
    to: ADMIN_EMAIL,
    subject: `MailRelay invite code for ${requesterEmail}`,
    html: `
      <p>A new user has requested access to MailRelay.</p>
      <p><strong>Name:</strong> ${requesterName}<br/>
         <strong>Email:</strong> ${requesterEmail}</p>
      <p>Their invite code is: <strong style="font-size:1.4em;letter-spacing:2px">${code}</strong></p>
      <p>This code expires in 48 hours. They can redeem it at:<br/>
         <a href="${APP_URL}/signup/redeem">${APP_URL}/signup/redeem</a></p>
    `,
    text: `A new user has requested access to MailRelay.\n\nName: ${requesterName}\nEmail: ${requesterEmail}\nInvite code: ${code}\n\nRedeem at ${APP_URL}/signup/redeem`,
  })
}
