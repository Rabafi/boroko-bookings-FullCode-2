/**
 * emailNotifications.js
 * Nodemailer-based email notification service for Boroko Command Central.
 * Config is persisted as email-config.json in the Electron userData directory.
 */

import nodemailer from 'nodemailer'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

function configPath() {
  return path.join(app.getPath('userData'), 'email-config.json')
}

/** Load config from disk; returns null if not configured yet */
export function getEmailConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Persist config to disk */
export function saveEmailConfig(config) {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/** Build a Nodemailer transporter from the stored config */
function createTransporter(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port) || 587,
    secure: Number(config.port) === 465,
    auth: {
      user: config.user,
      pass: config.pass
    },
    tls: { rejectUnauthorized: false }
  })
}

/**
 * Send a notification email.
 * @param {string} subject
 * @param {string} html   - HTML body
 * @param {string} [text] - Plain-text fallback
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function sendNotificationEmail(subject, html, text) {
  const config = getEmailConfig()
  if (!config || !config.host || !config.user || !config.pass || !config.to) {
    // Silently skip if not configured — don't break the main flow
    return { success: false, error: 'Email not configured' }
  }
  try {
    const transporter = createTransporter(config)
    await transporter.sendMail({
      from: config.from || `"Boroko Command Central" <${config.user}>`,
      to: config.to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, '')
    })
    return { success: true }
  } catch (e) {
    console.error('[Email] Failed to send:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * Send a test email to verify the configuration works.
 */
export async function testEmailConfig(config) {
  if (!config || !config.host || !config.user || !config.pass || !config.to) {
    return { success: false, error: 'Please fill in all fields before testing.' }
  }
  try {
    const transporter = createTransporter(config)
    await transporter.verify()
    await transporter.sendMail({
      from: config.from || `"Boroko Command Central" <${config.user}>`,
      to: config.to,
      subject: '✅ Boroko — Email Notifications Connected',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
          <h2 style="color:#166534;margin-bottom:8px;">Email notifications are working!</h2>
          <p style="color:#374151;">Your Command Central is now configured to send email alerts for:</p>
          <ul style="color:#374151;line-height:1.8;">
            <li>🆙 Upgrade requests from lodges</li>
            <li>🎫 Help / Support ticket submissions</li>
          </ul>
          <p style="color:#6b7280;font-size:13px;margin-top:24px;">Sent by Boroko Bookings — Command Central</p>
        </div>
      `
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * Send a license key email directly to the customer's registered email.
 */
export async function sendLicenseEmail({ to, licenseKey, lodgeName, plan, expiresAt, lodgeId, notes, invoice }) {
  const config = getEmailConfig()
  if (!config?.host || !config?.user || !config?.pass) {
    return { success: false, error: 'Email not configured. Set up SMTP in Command Central → Email Alerts.' }
  }
  if (!to?.trim()) {
    return { success: false, error: 'No email address found for this company.' }
  }

  const expiryDate = expiresAt ? new Date(expiresAt) : null
  const expiryText = (expiryDate && !isNaN(expiryDate.getTime()))
    ? expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'No expiry (lifetime)'

  const planLabel = plan || 'Starter'
  const year = new Date().getFullYear()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#14532d;padding:36px 40px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🏕️</div>
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Boroko Bookings</h1>
            <p style="color:#86efac;margin:6px 0 0;font-size:14px;">Your License is Ready to Activate</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:36px 40px 0;">
            <p style="margin:0;font-size:16px;color:#374151;">Dear <strong>${lodgeName || 'Valued Customer'}</strong>,</p>
            <p style="margin:16px 0 0;font-size:14px;color:#6b7280;line-height:1.7;">
              Thank you for choosing Boroko Bookings. Your license has been generated and is ready to activate.
              Follow the steps below to unlock your full subscription.
            </p>
          </td>
        </tr>

        <!-- License Key box -->
        <tr>
          <td style="padding:28px 40px;">
            <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#15803d;text-transform:uppercase;letter-spacing:1px;">Your Activation Key</p>
              <p style="margin:0;font-size:28px;font-weight:800;font-family:'Courier New',monospace;color:#14532d;letter-spacing:4px;">${licenseKey}</p>
            </div>
          </td>
        </tr>

        <!-- License Details table -->
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;width:40%;">Detail</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Value</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Business Name</td>
                <td style="padding:11px 16px;font-size:14px;color:#111827;font-weight:600;">${lodgeName || '—'}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#fafafa;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Subscription Plan</td>
                <td style="padding:11px 16px;font-size:14px;color:#14532d;font-weight:700;">${planLabel}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Expiry Date</td>
                <td style="padding:11px 16px;font-size:14px;color:#111827;font-weight:600;">${expiryText}</td>
              </tr>
              ${notes ? `<tr style="border-top:1px solid #e5e7eb;background:#fafafa;"><td style="padding:11px 16px;font-size:14px;color:#6b7280;">Notes</td><td style="padding:11px 16px;font-size:14px;color:#111827;">${notes}</td></tr>` : ''}
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Installation ID</td>
                <td style="padding:11px 16px;font-size:13px;color:#374151;font-family:'Courier New',monospace;">${lodgeId || '—'}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Payment / Invoice section (only when invoice is provided) -->
        ${invoice ? `
        <tr>
          <td style="padding:0 40px 28px;">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Payment Received</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f0fdf4;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;width:40%;">Invoice No.</td>
                <td style="padding:9px 16px;font-size:13px;color:#14532d;font-weight:700;font-family:'Courier New',monospace;">${invoice.invoice_number}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Package</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;font-weight:600;">${invoice.package_name}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#f9fafb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Amount Paid</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;font-weight:700;">${invoice.currency || 'USD'} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Payment Date</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;">${invoice.paid_date ? new Date(invoice.paid_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

        <!-- Activation steps -->
        <tr>
          <td style="padding:0 40px 28px;">
            <div style="background:#f8faff;border-left:4px solid #14532d;border-radius:0 8px 8px 0;padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#14532d;">How to Activate</p>
              <ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:2;">
                <li>Open <strong>Boroko Bookings</strong> on your computer</li>
                <li>Go to <strong>Settings → License &amp; Billing</strong></li>
                <li>Paste your activation key into the field and click <strong>Activate</strong></li>
                <li>Your license is live immediately ✓</li>
              </ol>
            </div>
          </td>
        </tr>

        <!-- Support note -->
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.7;">
              Need help? Reply to this email and we'll assist you.<br />
              Please keep this email safe — your activation key is unique to your installation.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© ${year} Boroko Bookings · Botswapelo Studios Pty Ltd</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const transporter = createTransporter(config)
    await transporter.sendMail({
      from: config.from || `"Boroko Bookings" <${config.user}>`,
      to: to.trim(),
      subject: `🔑 Your Boroko Bookings Activation Key — ${lodgeName || licenseKey}`,
      html,
      text: `Your Boroko Bookings activation key is: ${licenseKey}\nPlan: ${planLabel}\nExpiry: ${expiryText}\n\nTo activate: Open Boroko Bookings → Settings → License & Billing → paste the key → click Activate.`
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * Send a standalone invoice email directly to a client.
 */
export async function sendInvoiceEmail({ to, invoice, lodgeName }) {
  const config = getEmailConfig()
  if (!config?.host || !config?.user || !config?.pass) {
    return { success: false, error: 'Email not configured.' }
  }
  if (!to?.trim()) return { success: false, error: 'No recipient email.' }

  const year = new Date().getFullYear()
  const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
  const statusColor = { paid: '#16a34a', draft: '#6b7280', sent: '#2563eb', overdue: '#dc2626', cancelled: '#9ca3af' }
  const sc = statusColor[invoice.status] || '#6b7280'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#14532d;padding:32px 40px;text-align:center;">
            <div style="font-size:32px;margin-bottom:6px;">🏕️</div>
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Boroko Bookings</h1>
            <p style="color:#86efac;margin:4px 0 0;font-size:13px;">Invoice</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:13px;color:#6b7280;">Billed to</p>
                  <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827;">${lodgeName || invoice.lodge_name || '—'}</p>
                </td>
                <td align="right">
                  <p style="margin:0;font-size:22px;font-weight:800;color:#14532d;font-family:'Courier New',monospace;">${invoice.invoice_number}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Issued: ${fmtD(invoice.issued_date)}</p>
                  ${invoice.due_date ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Due: ${fmtD(invoice.due_date)}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Description</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:14px 16px;font-size:14px;color:#111827;">
                  <strong>${invoice.package_name} Subscription</strong>
                  ${invoice.description ? `<br/><span style="font-size:12px;color:#6b7280;">${invoice.description}</span>` : ''}
                </td>
                <td style="padding:14px 16px;font-size:14px;color:#111827;font-weight:700;text-align:right;">${invoice.currency || 'USD'} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
              <tr style="border-top:2px solid #e5e7eb;background:#f0fdf4;">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#14532d;">Total</td>
                <td style="padding:12px 16px;font-size:16px;font-weight:800;color:#14532d;text-align:right;">${invoice.currency || 'USD'} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">Status</td>
                <td><span style="background:${sc};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;text-transform:capitalize;">${invoice.status}</span></td>
              </tr>
              ${invoice.paid_date ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Paid on</td><td style="font-size:13px;color:#111827;font-weight:600;">${fmtD(invoice.paid_date)}</td></tr>` : ''}
              ${invoice.notes ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">Notes</td><td style="font-size:13px;color:#374151;">${invoice.notes}</td></tr>` : ''}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© ${year} Boroko Bookings · Botswapelo Studios Pty Ltd</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const transporter = createTransporter(config)
    await transporter.sendMail({
      from: config.from || `"Boroko Bookings" <${config.user}>`,
      to: to.trim(),
      subject: `Invoice ${invoice.invoice_number} — ${lodgeName || invoice.lodge_name || ''} · Boroko Bookings`,
      html,
      text: `Invoice ${invoice.invoice_number}\n${invoice.package_name} — ${invoice.currency || 'USD'} ${Number(invoice.amount).toFixed(2)}\nStatus: ${invoice.status}\nIssued: ${fmtD(invoice.issued_date)}`
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ── HTML builders ────────────────────────────────────────────────────────────

export function buildSupportTicketEmail({ lodge_name, lodge_id, title, description, category, priority }) {
  const priorityColor = { Urgent: '#dc2626', High: '#ea580c', Normal: '#2563eb', Low: '#6b7280' }
  const pc = priorityColor[priority] || '#2563eb'
  return {
    subject: `[Support Ticket] ${priority === 'Urgent' || priority === 'High' ? '🚨 ' : ''}${title} — ${lodge_name || lodge_id}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#166534;margin-bottom:4px;">New Support Ticket</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">From <strong>${lodge_name || 'Unknown Lodge'}</strong> (${lodge_id || ''})</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:90px;">Category</td><td style="font-size:13px;font-weight:600;">${category}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Priority</td><td><span style="background:${pc};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">${priority}</span></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Title</td><td style="font-size:13px;font-weight:600;">${title}</td></tr>
        </table>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#111827;white-space:pre-wrap;">${description}</div>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">Review this ticket in Command Central → Support Tickets tab.</p>
      </div>
    `
  }
}

export function buildUpgradeRequestEmail({ lodge_name, lodge_id, title, description }) {
  return {
    subject: `[Upgrade Request] 🆙 ${lodge_name || lodge_id} wants to upgrade`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#7c3aed;margin-bottom:4px;">Upgrade Request</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">From <strong>${lodge_name || 'Unknown Lodge'}</strong> (${lodge_id || ''})</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#111827;white-space:pre-wrap;margin-top:16px;">${description}</div>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">Action this request in Command Central → Support Tickets tab (filter by "Upgrade Request").</p>
      </div>
    `
  }
}
