/**
 * emailNotifications.js
 * Nodemailer-based email notification service for Tsa Bonno Command Central.
 * Config is persisted as email-config.json in the Electron userData directory.
 */

import nodemailer from 'nodemailer'
import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { formatSubscriptionPlan, getSubscriptionPlan } from '../shared/subscriptionPlans.js'
import { ECOSYSTEM_BRAND } from '../shared/brandIdentity.js'

const EMAIL_BRAND_NAME = ECOSYSTEM_BRAND.name
const EMAIL_LEGAL_OWNER = ECOSYSTEM_BRAND.legalOwner

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function configPath() {
  return path.join(app.getPath('userData'), 'email-config.json')
}

function decryptStoredPassword(config = {}) {
  if (config?.pass_encrypted && safeStorage?.isEncryptionAvailable?.()) {
    try {
      return safeStorage.decryptString(Buffer.from(String(config.pass_encrypted), 'base64'))
    } catch {
      return ''
    }
  }
  return config?.pass || ''
}

function normalizeEmailConfig(config = {}) {
  return {
    provider: config?.provider || 'custom',
    host: config?.host || '',
    port: Number(config?.port) || 587,
    user: config?.user || '',
    pass: decryptStoredPassword(config),
    from: config?.from || '',
    to: config?.to || '',
    reply_to: config?.reply_to || '',
    allow_insecure_tls: config?.allow_insecure_tls === true,
    auto_send_quotations: config?.auto_send_quotations === true,
    auto_send_booking_invoice: config?.auto_send_booking_invoice === true,
    auto_send_booking_confirmation: config?.auto_send_booking_confirmation === true,
    auto_send_booking_cancellation: config?.auto_send_booking_cancellation === true
  }
}

/** Load config from disk; returns null if not configured yet */
export function getEmailConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeEmailConfig(parsed)
  } catch {
    return null
  }
}

/** Persist config to disk */
export function saveEmailConfig(config) {
  try {
    const normalized = normalizeEmailConfig(config)
    const persisted = { ...normalized }
    if (persisted.pass && safeStorage?.isEncryptionAvailable?.()) {
      persisted.pass_encrypted = safeStorage.encryptString(persisted.pass).toString('base64')
      persisted.pass_encryption = 'electron-safe-storage-v1'
      persisted.pass = ''
    }
    fs.writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/** Build a Nodemailer transporter from the stored config */
function createTransporter(config) {
  const normalized = normalizeEmailConfig(config)
  const allowInsecureTls = normalized.allow_insecure_tls === true
  return nodemailer.createTransport({
    host: normalized.host,
    port: Number(normalized.port) || 587,
    secure: Number(normalized.port) === 465,
    auth: {
      user: normalized.user,
      pass: normalized.pass
    },
    tls: {
      rejectUnauthorized: !allowInsecureTls
    }
  })
}

async function sendStoredConfigEmail({ to, subject, html, text, from, replyTo, attachments }) {
  const config = getEmailConfig()
  if (!config?.host || !config?.user || !config?.pass) {
    return { success: false, error: 'Email not configured.' }
  }
  if (!to?.trim()) return { success: false, error: 'No recipient email.' }

  try {
    const transporter = createTransporter(config)
    await transporter.sendMail({
      from: from || config.from || `"${EMAIL_BRAND_NAME}" <${config.user}>`,
      to: to.trim(),
      replyTo: replyTo || config.reply_to || undefined,
      subject,
      html,
      text,
      attachments
    })
    return { success: true, subject }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function sendPurchaseOrderEmail({ to, purchaseOrder, businessName, currency = 'P', pdfBuffer, filename }) {
  if (!pdfBuffer) return { success: false, error: 'Purchase order PDF could not be generated.' }
  const supplierName = escapeHtml(purchaseOrder?.supplier?.name || 'Supplier')
  const reference = escapeHtml(String(purchaseOrder?.id || '').slice(-6).toUpperCase() || 'PURCHASE ORDER')
  const safeBusinessName = escapeHtml(businessName || EMAIL_BRAND_NAME)
  const total = Number(purchaseOrder?.total || 0).toFixed(2)
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#24202a;max-width:620px;margin:auto"><div style="background:#35242c;color:white;padding:28px 32px;border-radius:14px 14px 0 0"><h1 style="margin:0;font-size:22px">Purchase order ${reference}</h1><p style="margin:7px 0 0;color:#f6d8ba">${safeBusinessName}</p></div><div style="padding:28px 32px;border:1px solid #eadedb;border-top:0;border-radius:0 0 14px 14px"><p>Hello ${supplierName},</p><p>Please find our approved purchase order attached. Please confirm availability and delivery timing.</p><p style="font-weight:700">Order total: ${escapeHtml(currency)} ${total}</p><p style="color:#6b5b62;font-size:13px">Reply to this email if you need clarification.</p></div></div>`
  return sendStoredConfigEmail({
    to,
    subject: `Purchase Order ${reference} — ${businessName || EMAIL_BRAND_NAME}`,
    html,
    text: `Purchase Order ${reference}\nPlease find the purchase order attached.\nOrder total: ${currency} ${total}`,
    attachments: [{ filename: filename || `purchase-order-${reference.toLowerCase()}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
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
      from: config.from || `"Tsa Bonno Command Central" <${config.user}>`,
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
      from: config.from || `"Tsa Bonno Command Central" <${config.user}>`,
      to: config.to,
      subject: '✅ Tsa Bonno — Email Notifications Connected',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
          <h2 style="color:#166534;margin-bottom:8px;">Your lodge email is working</h2>
          <p style="color:#374151;">Tsa Bonno can now send guest-facing emails from this computer, including:</p>
          <ul style="color:#374151;line-height:1.8;">
            <li>Booking confirmations</li>
            <li>Booking cancellation confirmations</li>
            <li>Booking invoices</li>
            <li>Quotation emails</li>
          </ul>
          <p style="color:#6b7280;font-size:13px;margin-top:24px;">If you received this email, your SMTP settings are ready.</p>
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

  const planLabel = formatSubscriptionPlan(plan)
  const year = new Date().getFullYear()
  const safeLodgeName = escapeHtml(lodgeName || 'Valued Customer')
  const safeLicenseKey = escapeHtml(licenseKey)
  const safePlanLabel = escapeHtml(planLabel)
  const safeExpiryText = escapeHtml(expiryText)
  const safeNotes = notes ? escapeHtml(notes) : ''
  const safeLodgeId = escapeHtml(lodgeId || '—')
  const safeInvoiceNumber = escapeHtml(invoice?.invoice_number || '')
  const safeInvoicePackage = escapeHtml(formatSubscriptionPlan(invoice?.package_name))
  const safeInvoiceCurrency = escapeHtml(invoice?.currency || 'USD')
  const safePaidDate = escapeHtml(invoice?.paid_date ? new Date(invoice.paid_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—')

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
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${EMAIL_BRAND_NAME}</h1>
            <p style="color:#86efac;margin:6px 0 0;font-size:14px;">Your License is Ready to Activate</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:36px 40px 0;">
            <p style="margin:0;font-size:16px;color:#374151;">Dear <strong>${safeLodgeName}</strong>,</p>
            <p style="margin:16px 0 0;font-size:14px;color:#6b7280;line-height:1.7;">
              Thank you for choosing ${EMAIL_BRAND_NAME}. Your license has been generated and is ready to activate.
              Follow the steps below to unlock your full subscription.
            </p>
          </td>
        </tr>

        <!-- License Key box -->
        <tr>
          <td style="padding:28px 40px;">
            <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:10px;padding:24px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#15803d;text-transform:uppercase;letter-spacing:1px;">Your Activation Key</p>
              <p style="margin:0;font-size:28px;font-weight:800;font-family:'Courier New',monospace;color:#14532d;letter-spacing:4px;">${safeLicenseKey}</p>
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
                <td style="padding:11px 16px;font-size:14px;color:#111827;font-weight:600;">${safeLodgeName}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#fafafa;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Subscription Plan</td>
                <td style="padding:11px 16px;font-size:14px;color:#14532d;font-weight:700;">${safePlanLabel}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Expiry Date</td>
                <td style="padding:11px 16px;font-size:14px;color:#111827;font-weight:600;">${safeExpiryText}</td>
              </tr>
              ${notes ? `<tr style="border-top:1px solid #e5e7eb;background:#fafafa;"><td style="padding:11px 16px;font-size:14px;color:#6b7280;">Notes</td><td style="padding:11px 16px;font-size:14px;color:#111827;">${safeNotes}</td></tr>` : ''}
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:11px 16px;font-size:14px;color:#6b7280;">Installation ID</td>
                <td style="padding:11px 16px;font-size:13px;color:#374151;font-family:'Courier New',monospace;">${safeLodgeId}</td>
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
                <td style="padding:9px 16px;font-size:13px;color:#14532d;font-weight:700;font-family:'Courier New',monospace;">${safeInvoiceNumber}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Package</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;font-weight:600;">${safeInvoicePackage}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;background:#f9fafb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Amount Paid</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;font-weight:700;">${safeInvoiceCurrency} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:9px 16px;font-size:13px;color:#6b7280;">Payment Date</td>
                <td style="padding:9px 16px;font-size:13px;color:#111827;">${safePaidDate}</td>
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
                <li>Open the matching <strong>${EMAIL_BRAND_NAME}</strong> application on your computer</li>
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
            <p style="margin:0;font-size:12px;color:#9ca3af;">© ${year} ${EMAIL_BRAND_NAME} · ${EMAIL_LEGAL_OWNER}</p>
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
      from: config.from || `"${EMAIL_BRAND_NAME}" <${config.user}>`,
      to: to.trim(),
      subject: `🔑 Your ${EMAIL_BRAND_NAME} Activation Key — ${lodgeName || licenseKey}`,
      html,
      text: `Your ${EMAIL_BRAND_NAME} activation key is: ${licenseKey}\nPlan: ${planLabel}\nExpiry: ${expiryText}\n\nTo activate: Open the matching Tsa Bonno application → Settings → License & Billing → paste the key → click Activate.`
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
  const safeLodgeName = escapeHtml(lodgeName || invoice.lodge_name || '—')
  const safeInvoiceNumber = escapeHtml(invoice.invoice_number)
  const safePackageName = escapeHtml(formatSubscriptionPlan(invoice.package_name))
  const safeDescription = invoice.description ? escapeHtml(invoice.description) : ''
  const safeStatus = escapeHtml(invoice.status)
  const safeNotes = invoice.notes ? escapeHtml(invoice.notes) : ''
  const safeIssuedDate = escapeHtml(fmtD(invoice.issued_date))
  const safeDueDate = invoice.due_date ? escapeHtml(fmtD(invoice.due_date)) : ''
  const safePaidDate = invoice.paid_date ? escapeHtml(fmtD(invoice.paid_date)) : ''
  const safeCurrency = escapeHtml(invoice.currency || 'USD')

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
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${EMAIL_BRAND_NAME}</h1>
            <p style="color:#86efac;margin:4px 0 0;font-size:13px;">Invoice</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:13px;color:#6b7280;">Billed to</p>
                  <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827;">${safeLodgeName}</p>
                </td>
                <td align="right">
                  <p style="margin:0;font-size:22px;font-weight:800;color:#14532d;font-family:'Courier New',monospace;">${safeInvoiceNumber}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Issued: ${safeIssuedDate}</p>
                  ${invoice.due_date ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Due: ${safeDueDate}</p>` : ''}
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
                  <strong>${safePackageName} Subscription</strong>
                  ${invoice.description ? `<br/><span style="font-size:12px;color:#6b7280;">${safeDescription}</span>` : ''}
                </td>
                <td style="padding:14px 16px;font-size:14px;color:#111827;font-weight:700;text-align:right;">${safeCurrency} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
              <tr style="border-top:2px solid #e5e7eb;background:#f0fdf4;">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#14532d;">Total</td>
                <td style="padding:12px 16px;font-size:16px;font-weight:800;color:#14532d;text-align:right;">${safeCurrency} ${Number(invoice.amount).toFixed(2)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;width:120px;">Status</td>
                <td><span style="background:${sc};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;text-transform:capitalize;">${safeStatus}</span></td>
              </tr>
              ${invoice.paid_date ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;">Paid on</td><td style="font-size:13px;color:#111827;font-weight:600;">${safePaidDate}</td></tr>` : ''}
              ${invoice.notes ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">Notes</td><td style="font-size:13px;color:#374151;">${safeNotes}</td></tr>` : ''}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© ${year} ${EMAIL_BRAND_NAME} · ${EMAIL_LEGAL_OWNER}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return sendStoredConfigEmail({
    to,
    subject: `Invoice ${invoice.invoice_number} — ${lodgeName || invoice.lodge_name || ''} · ${EMAIL_BRAND_NAME}`,
    html,
    text: `Invoice ${invoice.invoice_number}\n${formatSubscriptionPlan(invoice.package_name)} — ${invoice.currency || 'USD'} ${Number(invoice.amount).toFixed(2)}\nStatus: ${invoice.status}\nIssued: ${fmtD(invoice.issued_date)}`
  })
}

export async function sendBookingInvoiceEmail({ to, invoice, lodgeName, currency = 'P' }) {
  const config = getEmailConfig()
  if (!config?.host || !config?.user || !config?.pass) {
    return { success: false, error: 'Email not configured.' }
  }
  if (!to?.trim()) return { success: false, error: 'No recipient email.' }

  const year = new Date().getFullYear()
  const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
  const totalAmount = Number(invoice?.total_amount || 0)
  const amountPaid = Number(invoice?.amount_paid || 0)
  const balanceDue = Math.max(0, Number(invoice?.balance_due ?? (totalAmount - amountPaid)))
  const safeLodgeName = escapeHtml(lodgeName || EMAIL_BRAND_NAME)
  const safeGuestName = escapeHtml(invoice?.customer_name || 'Guest')
  const safeRoomNumber = escapeHtml(invoice?.room_number || '—')
  const safeRoomType = escapeHtml(invoice?.room_type || 'Room')
  const safeInvoiceNumber = escapeHtml(invoice?.invoice_number || 'Invoice')
  const safeIssuedAt = escapeHtml(fmtD(invoice?.issued_at || invoice?.created_at))
  const safeCheckIn = escapeHtml(fmtD(invoice?.check_in))
  const safeCheckOut = escapeHtml(fmtD(invoice?.check_out))
  const safeCurrency = escapeHtml(currency)
  const safeBookingStatus = escapeHtml(String(invoice?.status || 'confirmed').replace(/_/g, ' '))
  const safePaymentStatus = escapeHtml(String(invoice?.payment_status || 'unpaid').replace(/_/g, ' '))
  const safeNotes = invoice?.notes ? escapeHtml(invoice.notes) : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#14532d;padding:32px 40px;text-align:center;">
            <div style="font-size:32px;margin-bottom:6px;">🏕️</div>
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">${safeLodgeName}</h1>
            <p style="color:#bbf7d0;margin:6px 0 0;font-size:13px;">Guest booking invoice</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:13px;color:#6b7280;">Guest</p>
                  <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#111827;">${safeGuestName}</p>
                  <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">Room ${safeRoomNumber} · ${safeRoomType}</p>
                </td>
                <td align="right">
                  <p style="margin:0;font-size:22px;font-weight:800;color:#14532d;font-family:'Courier New',monospace;">${safeInvoiceNumber}</p>
                  <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Issued: ${safeIssuedAt}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Stay: ${safeCheckIn} → ${safeCheckOut}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Description</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:14px 16px;font-size:14px;color:#111827;">
                  <strong>Accommodation charges</strong><br />
                  <span style="font-size:12px;color:#6b7280;">${safeCheckIn} to ${safeCheckOut} · ${invoice?.nights || 0} night(s)</span>
                </td>
                <td style="padding:14px 16px;font-size:14px;color:#111827;font-weight:700;text-align:right;">${safeCurrency} ${totalAmount.toFixed(2)}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="padding:12px 16px;font-size:14px;color:#374151;">Payments received</td>
                <td style="padding:12px 16px;font-size:14px;color:#166534;font-weight:700;text-align:right;">${safeCurrency} ${amountPaid.toFixed(2)}</td>
              </tr>
              <tr style="border-top:2px solid #e5e7eb;background:${balanceDue > 0 ? '#fffbeb' : '#f0fdf4'};">
                <td style="padding:12px 16px;font-size:14px;font-weight:700;color:${balanceDue > 0 ? '#92400e' : '#14532d'};">Balance due</td>
                <td style="padding:12px 16px;font-size:16px;font-weight:800;color:${balanceDue > 0 ? '#92400e' : '#14532d'};text-align:right;">${safeCurrency} ${balanceDue.toFixed(2)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 24px;">
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;">Booking summary</p>
              <p style="margin:0;font-size:13px;color:#4b5563;">Booking status: ${safeBookingStatus}</p>
              <p style="margin:6px 0 0;font-size:13px;color:#4b5563;">Payment status: ${safePaymentStatus}</p>
              ${invoice?.notes ? `<p style="margin:10px 0 0;font-size:13px;color:#4b5563;">Notes: ${safeNotes}</p>` : ''}
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">© ${year} ${safeLodgeName}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return sendStoredConfigEmail({
    to,
    from: config.from || `"${lodgeName || EMAIL_BRAND_NAME}" <${config.user}>`,
    subject: `Invoice ${invoice?.invoice_number || ''} — ${lodgeName || EMAIL_BRAND_NAME}`.trim(),
    html,
    text: `Invoice ${invoice?.invoice_number || ''}\nGuest: ${invoice?.customer_name || 'Guest'}\nStay: ${fmtD(invoice?.check_in)} to ${fmtD(invoice?.check_out)}\nTotal: ${currency} ${totalAmount.toFixed(2)}\nPaid: ${currency} ${amountPaid.toFixed(2)}\nBalance: ${currency} ${balanceDue.toFixed(2)}`
  })
}

export async function sendQuotationEmail({ to, quotation, lodgeName, settings = {} }) {
  const config = getEmailConfig()
  if (!config?.host || !config?.user || !config?.pass) {
    return { success: false, error: 'Email not configured.' }
  }

  const safeLodgeName = escapeHtml(lodgeName || settings?.lodge_name || 'Your lodge')
  const safeGuestName = escapeHtml(quotation?.customer_name || 'Guest')
  const safeQuotationNumber = escapeHtml(quotation?.quotation_number || 'Quotation')
  const isEventQuotation = quotation?.quotation_type === 'exclusive_event'
  const safeEventName = escapeHtml(quotation?.event_name || 'Exclusive event')
  const safeRoomName = escapeHtml(isEventQuotation ? 'Full Lodge' : quotation?.room_name || 'Room details will be confirmed')
  const safeBookingLabel = isEventQuotation ? safeEventName : safeRoomName
  const safeBookingLabelTitle = isEventQuotation ? 'Event / group' : 'Room'
  const safeCurrency = escapeHtml(quotation?.currency || settings?.currency || 'BWP')
  const safeCheckIn = escapeHtml(quotation?.check_in ? new Date(quotation.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safeCheckOut = escapeHtml(quotation?.check_out ? new Date(quotation.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safeValidUntil = escapeHtml(quotation?.valid_until ? new Date(quotation.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not specified')
  const safeTotal = Number(quotation?.total_amount || 0).toFixed(2)
  const safeDailyRate = Number(quotation?.event_daily_rate || 0).toFixed(2)
  const safeNotes = quotation?.notes ? escapeHtml(quotation.notes) : ''
  const safePhone = settings?.phone ? escapeHtml(settings.phone) : ''
  const safeEmail = settings?.email ? escapeHtml(settings.email) : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#14532d;padding:32px 40px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">${safeLodgeName}</h1>
            <p style="color:#bbf7d0;margin:6px 0 0;font-size:13px;">Your quotation is ready</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 24px;">
            <p style="margin:0;font-size:15px;color:#111827;">Hello ${safeGuestName},</p>
            <p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#4b5563;">
              We have prepared a quotation for your ${isEventQuotation ? 'exclusive event and full-lodge reservation' : 'stay'}. The summary below shows the ${isEventQuotation ? 'event, dates' : 'room, dates'}, and amount currently offered.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Detail</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Value</td>
              </tr>
              <tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Quotation number</td><td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:700;">${safeQuotationNumber}</td></tr>
              <tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">${safeBookingLabelTitle}</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeBookingLabel}</td></tr>
              ${isEventQuotation ? `<tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Reservation</td><td style="padding:12px 16px;font-size:14px;color:#111827;">Full Lodge</td></tr>` : ''}
              <tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Check-in</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckIn}</td></tr>
              <tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Check-out</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckOut}</td></tr>
              ${isEventQuotation ? `<tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Whole-lodge daily rate</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCurrency} ${safeDailyRate}</td></tr>` : ''}
              <tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Valid until</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeValidUntil}</td></tr>
              <tr style="background:#f0fdf4;"><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#14532d;">Quoted total</td><td style="padding:12px 16px;font-size:16px;font-weight:800;color:#14532d;">${safeCurrency} ${safeTotal}</td></tr>
            </table>
          </td>
        </tr>
        ${quotation?.notes ? `<tr><td style="padding:0 40px 24px;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;"><p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;">Notes</p><p style="margin:0;font-size:13px;line-height:1.7;color:#4b5563;">${safeNotes}</p></div></td></tr>` : ''}
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">
              If you would like to go ahead, please reply to this email or contact the lodge so front desk can confirm the booking.
              ${safePhone || safeEmail ? `<br /><br />Contact: ${[safePhone, safeEmail].filter(Boolean).join(' · ')}` : ''}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return sendStoredConfigEmail({
    to,
    from: config.from || `"${lodgeName || settings?.lodge_name || EMAIL_BRAND_NAME}" <${config.user}>`,
    subject: `Quotation ${quotation?.quotation_number || ''} — ${lodgeName || settings?.lodge_name || 'Your lodge'}`.trim(),
    html,
    text: `Quotation ${quotation?.quotation_number || ''}\nGuest: ${quotation?.customer_name || 'Guest'}\n${isEventQuotation ? `Event: ${quotation?.event_name || 'Exclusive event'}\nReservation: Full Lodge\nDaily rate: ${safeCurrency} ${safeDailyRate}` : `Room: ${quotation?.room_name || 'To be confirmed'}`}\nCheck-in: ${safeCheckIn}\nCheck-out: ${safeCheckOut}\nValid until: ${safeValidUntil}\nQuoted total: ${safeCurrency} ${safeTotal}`
  })
}

export async function sendBookingConfirmationEmail({ to, booking, lodgeName, settings = {}, currency = 'P' }) {
  const safeLodgeName = escapeHtml(lodgeName || settings?.lodge_name || 'Your lodge')
  const safeGuestName = escapeHtml(booking?.customer_name || 'Guest')
  const safeBookingNumber = escapeHtml(booking?.invoice_number || booking?.booking_number || 'Booking')
  const safeRoom = escapeHtml(booking?.room_number ? `Room ${booking.room_number}` : booking?.room_type || 'Room details will be confirmed')
  const safeCheckIn = escapeHtml(booking?.check_in ? new Date(booking.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safeCheckOut = escapeHtml(booking?.check_out ? new Date(booking.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safeCurrency = escapeHtml(currency || settings?.currency || 'P')
  const safeTotal = Number(booking?.total_amount || 0).toFixed(2)
  const safePaid = Number(booking?.amount_paid || 0).toFixed(2)
  const safeBalance = Math.max(0, Number(booking?.total_amount || 0) + Number(booking?.charges_total || 0) - Number(booking?.amount_paid || 0)).toFixed(2)
  const safePaymentTerms = settings?.booking_payment_terms ? escapeHtml(settings.booking_payment_terms) : ''
  const safePhone = settings?.phone ? escapeHtml(settings.phone) : ''
  const safeEmail = settings?.email ? escapeHtml(settings.email) : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#14532d;padding:32px 40px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">${safeLodgeName}</h1><p style="color:#bbf7d0;margin:6px 0 0;font-size:13px;">Your booking has been confirmed</p></td></tr>
        <tr><td style="padding:32px 40px 20px;"><p style="margin:0;font-size:15px;color:#111827;">Hello ${safeGuestName},</p><p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#4b5563;">Front desk has confirmed your booking. Here is a simple summary for your records.</p></td></tr>
        <tr><td style="padding:0 40px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><tr style="background:#f9fafb;"><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Detail</td><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Value</td></tr><tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Booking reference</td><td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:700;">${safeBookingNumber}</td></tr><tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Room</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeRoom}</td></tr><tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Check-in</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckIn}</td></tr><tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Check-out</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckOut}</td></tr><tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Booking total</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCurrency} ${safeTotal}</td></tr><tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Paid so far</td><td style="padding:12px 16px;font-size:14px;color:#166534;font-weight:700;">${safeCurrency} ${safePaid}</td></tr><tr style="background:#fffbeb;"><td style="padding:12px 16px;font-size:14px;font-weight:700;color:#92400e;">Balance due</td><td style="padding:12px 16px;font-size:16px;font-weight:800;color:#92400e;">${safeCurrency} ${safeBalance}</td></tr></table></td></tr>
        ${settings?.booking_payment_terms ? `<tr><td style="padding:0 40px 24px;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;"><p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;">Payment terms</p><p style="margin:0;font-size:13px;line-height:1.7;color:#4b5563;">${safePaymentTerms}</p></div></td></tr>` : ''}
        <tr><td style="padding:0 40px 32px;"><p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">If you need any changes before arrival, please reply to this email or contact the lodge.${safePhone || safeEmail ? `<br /><br />Contact: ${[safePhone, safeEmail].filter(Boolean).join(' · ')}` : ''}</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return sendStoredConfigEmail({
    to,
    subject: `Booking confirmed — ${safeLodgeName}`.replace(/&amp;/g, '&'),
    html,
    text: `Booking confirmed\nReference: ${booking?.invoice_number || booking?.booking_number || 'Booking'}\nRoom: ${booking?.room_number ? `Room ${booking.room_number}` : booking?.room_type || 'Room details will be confirmed'}\nCheck-in: ${safeCheckIn}\nCheck-out: ${safeCheckOut}\nTotal: ${safeCurrency} ${safeTotal}\nPaid: ${safeCurrency} ${safePaid}\nBalance: ${safeCurrency} ${safeBalance}`
  })
}

export async function sendBookingCancellationEmail({ to, booking, lodgeName, settings = {} }) {
  const safeLodgeName = escapeHtml(lodgeName || settings?.lodge_name || 'Your lodge')
  const safeGuestName = escapeHtml(booking?.customer_name || 'Guest')
  const safeBookingNumber = escapeHtml(booking?.invoice_number || booking?.booking_number || 'Booking')
  const safeCheckIn = escapeHtml(booking?.check_in ? new Date(booking.check_in).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safeCheckOut = escapeHtml(booking?.check_out ? new Date(booking.check_out).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed')
  const safePhone = settings?.phone ? escapeHtml(settings.phone) : ''
  const safeEmail = settings?.email ? escapeHtml(settings.email) : ''
  const safePolicy = settings?.booking_cancellation_policy ? escapeHtml(settings.booking_cancellation_policy) : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#7f1d1d;padding:32px 40px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">${safeLodgeName}</h1><p style="color:#fecaca;margin:6px 0 0;font-size:13px;">Your booking has been cancelled</p></td></tr>
        <tr><td style="padding:32px 40px 20px;"><p style="margin:0;font-size:15px;color:#111827;">Hello ${safeGuestName},</p><p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#4b5563;">This email confirms that your booking has been cancelled by front desk.</p></td></tr>
        <tr><td style="padding:0 40px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><tr style="background:#f9fafb;"><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Detail</td><td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;">Value</td></tr><tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Booking reference</td><td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:700;">${safeBookingNumber}</td></tr><tr style="background:#fafafa;"><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Original check-in</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckIn}</td></tr><tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Original check-out</td><td style="padding:12px 16px;font-size:14px;color:#111827;">${safeCheckOut}</td></tr></table></td></tr>
        <tr><td style="padding:0 40px 16px;"><div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;"><p style="margin:0;font-size:13px;line-height:1.7;color:#7f1d1d;">If any refund or retained deposit applies, the lodge will communicate that separately through the normal payment process.</p></div></td></tr>
        ${settings?.booking_cancellation_policy ? `<tr><td style="padding:0 40px 24px;"><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;"><p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111827;">Cancellation policy</p><p style="margin:0;font-size:13px;line-height:1.7;color:#4b5563;">${safePolicy}</p></div></td></tr>` : ''}
        <tr><td style="padding:0 40px 32px;"><p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">If you believe this was a mistake, please contact the lodge straight away.${safePhone || safeEmail ? `<br /><br />Contact: ${[safePhone, safeEmail].filter(Boolean).join(' · ')}` : ''}</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return sendStoredConfigEmail({
    to,
    subject: `Booking cancelled — ${safeLodgeName}`.replace(/&amp;/g, '&'),
    html,
    text: `Booking cancelled\nReference: ${booking?.invoice_number || booking?.booking_number || 'Booking'}\nOriginal check-in: ${safeCheckIn}\nOriginal check-out: ${safeCheckOut}\nIf any refund or retained deposit applies, the lodge will confirm that separately.`
  })
}

// ── HTML builders ────────────────────────────────────────────────────────────

export function buildSupportTicketEmail({ lodge_name, lodge_id, title, description, category, priority }) {
  const priorityColor = { Urgent: '#dc2626', High: '#ea580c', Normal: '#2563eb', Low: '#6b7280' }
  const pc = priorityColor[priority] || '#2563eb'
  const safeLodgeName = escapeHtml(lodge_name || 'Unknown Lodge')
  const safeLodgeId = escapeHtml(lodge_id || '')
  const safeCategory = escapeHtml(category)
  const safePriority = escapeHtml(priority)
  const safeTitle = escapeHtml(title)
  const safeDescription = escapeHtml(description)
  return {
    subject: `[Support Ticket] ${priority === 'Urgent' || priority === 'High' ? '🚨 ' : ''}${title} — ${lodge_name || lodge_id}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#166534;margin-bottom:4px;">New Support Ticket</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">From <strong>${safeLodgeName}</strong> (${safeLodgeId})</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:90px;">Category</td><td style="font-size:13px;font-weight:600;">${safeCategory}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Priority</td><td><span style="background:${pc};color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">${safePriority}</span></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Title</td><td style="font-size:13px;font-weight:600;">${safeTitle}</td></tr>
        </table>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#111827;white-space:pre-wrap;">${safeDescription}</div>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">Review this ticket in Command Central → Support Tickets tab.</p>
      </div>
    `
  }
}

export function buildUpgradeRequestEmail({ lodge_name, lodge_id, title, description }) {
  const safeLodgeName = escapeHtml(lodge_name || 'Unknown Lodge')
  const safeLodgeId = escapeHtml(lodge_id || '')
  const safeDescription = escapeHtml(description)
  return {
    subject: `[Upgrade Request] 🆙 ${lodge_name || lodge_id} wants to upgrade`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#f9fafb;border-radius:12px;">
        <h2 style="color:#7c3aed;margin-bottom:4px;">Upgrade Request</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">From <strong>${safeLodgeName}</strong> (${safeLodgeId})</p>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:14px 16px;margin-top:16px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#5b21b6;">Subscription ladder</p>
          <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Starter: ${getSubscriptionPlan('Starter').pitch}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Standard: ${getSubscriptionPlan('Standard').pitch}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Pro: ${getSubscriptionPlan('Pro').pitch}</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#111827;white-space:pre-wrap;margin-top:16px;">${safeDescription}</div>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">Action this request in Command Central → Support Tickets tab (filter by "Upgrade Request").</p>
      </div>
    `
  }
}
