import nodemailer from 'nodemailer'

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

/**
 * Sends the generated invite code TO THE ADMIN (SMTP_USER).
 * The admin then manually passes the code to the new user.
 */
export async function sendInviteCodeToAdmin(requesterName: string, requesterEmail: string, code: string) {
  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER, // always goes to the admin inbox
    subject: `MailRelay Invite Code for ${requesterEmail}`,
    html: `
      <p>A new user has requested access to MailRelay.</p>
      <p><strong>Name:</strong> ${requesterName}<br/>
         <strong>Email:</strong> ${requesterEmail}</p>
      <p>Their invite code is: <strong style="font-size:1.4em;letter-spacing:2px">${code}</strong></p>
      <p>This code expires in 48 hours. Pass it to the user so they can redeem it at:<br/>
         <a href="${APP_URL}/signup/redeem">${APP_URL}/signup/redeem</a></p>
      <hr/>
      <p style="color:#888;font-size:12px">You can also view and manage all codes at 
         <a href="${APP_URL}/admin/invites">${APP_URL}/admin/invites</a></p>
    `,
  })
}

/**
 * Notifies the admin that a new signup request arrived (before code is generated).
 */
export async function sendAdminNotification(name: string, email: string) {
  await transporter.sendMail({
    from: `MailRelay <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    subject: `New MailRelay Signup Request from ${name}`,
    html: `
      <p><strong>${name}</strong> (${email}) has requested access to MailRelay.</p>
      <p>Go to your <a href="${APP_URL}/admin/invites">admin panel</a> to generate and send them an invite code.</p>
    `,
  })
}
