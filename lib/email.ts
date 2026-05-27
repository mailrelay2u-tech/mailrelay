import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { promises as dns } from 'dns'

async function createTransporter() {
  let smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
  try {
    const addrs = await dns.resolve4(smtpHost)
    if (addrs.length > 0) smtpHost = addrs[0]
  } catch {}

  const options: SMTPTransport.Options = {
    host: smtpHost,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false, servername: process.env.SMTP_HOST || 'smtp.gmail.com' },
  }

  return nodemailer.createTransport(options)
}

export async function getTransporter() {
  return createTransporter()
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.SMTP_USER

/**
 * Sends a welcome / verify-your-email notice to the new user.
 * Supabase Auth handles the actual verification link — this is just a branded welcome.
 */
export async function sendWelcomeEmail(toEmail: string, name: string) {
  const transporter = await getTransporter()
  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Welcome to MailRelay — verify your email',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#4B6BF1">Welcome to MailRelay, ${name}!</h2>
        <p>Your account has been created. Check your inbox for a verification email from Supabase to confirm your address.</p>
        <p>Once verified, sign in at:<br/>
           <a href="${APP_URL}/login">${APP_URL}/login</a></p>
        <p style="color:#888;font-size:12px">If you didn't sign up, ignore this email.</p>
      </div>
    `,
  })
}

/**
 * Notifies the superadmin that a new user signed up.
 */
export async function sendAdminNotification(name: string, email: string) {
  const transporter = await getTransporter()
  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: ADMIN_EMAIL,
    subject: `New MailRelay signup: ${name}`,
    html: `
      <p><strong>${name}</strong> (${email}) just signed up for MailRelay.</p>
      <p>View users at <a href="${APP_URL}/admin/invites">${APP_URL}/admin/invites</a></p>
    `,
  })
}

/**
 * Sends the generated invite code TO THE ADMIN.
 * Kept for manual invite flow if superadmin wants to invite someone directly.
 */
export async function sendInviteCodeToAdmin(requesterName: string, requesterEmail: string, code: string) {
  const transporter = await getTransporter()
  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: ADMIN_EMAIL,
    subject: `MailRelay Invite Code for ${requesterEmail}`,
    html: `
      <p>A new user has requested access to MailRelay.</p>
      <p><strong>Name:</strong> ${requesterName}<br/>
         <strong>Email:</strong> ${requesterEmail}</p>
      <p>Their invite code is: <strong style="font-size:1.4em;letter-spacing:2px">${code}</strong></p>
      <p>This code expires in 48 hours. Pass it to the user so they can redeem it at:<br/>
         <a href="${APP_URL}/signup/redeem">${APP_URL}/signup/redeem</a></p>
    `,
  })
}
