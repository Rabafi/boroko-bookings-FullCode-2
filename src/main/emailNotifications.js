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
