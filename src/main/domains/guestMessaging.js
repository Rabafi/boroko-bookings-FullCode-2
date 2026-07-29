import { createRequire } from 'module'
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const require = createRequire(import.meta.url)

const TEMPLATES_CACHE = 'guest-message-templates'
const TRIGGERS_CACHE = 'guest-message-triggers'

/** Channels that require an external provider. Until configured they must never report "sent". */
const PROVIDER_CHANNELS = new Set(['sms', 'whatsapp'])

function loadEmailConfigSafe() {
  try {
    // Lazy load so static import of this domain does not pull Electron-only modules at test time.
    const mod = require('../emailNotifications.js')
    return typeof mod.getEmailConfig === 'function' ? mod.getEmailConfig() : null
  } catch {
    return null
  }
}

/**
 * Report whether a messaging channel can actually deliver.
 * Email uses local SMTP (nodemailer) when configured.
 * SMS/WhatsApp have no provider adapter yet — fail closed.
 */
export function getChannelReadiness(channel) {
  const ch = String(channel || 'email').toLowerCase()
  if (ch === 'email') {
    try {
      const config = loadEmailConfigSafe()
      const ready = Boolean(config?.host && config?.user && config?.pass)
      return {
        channel: 'email',
        ready,
        status: ready ? 'ready' : 'not_configured',
        label: ready ? 'Email transport configured' : 'Email not configured',
        message: ready
          ? 'SMTP is configured on this workstation.'
          : 'Email is not configured. Messages stay queued until SMTP is set up in Settings / Command Central.'
      }
    } catch {
      return {
        channel: 'email',
        ready: false,
        status: 'not_configured',
        label: 'Email not configured',
        message: 'Email transport is unavailable in this environment.'
      }
    }
  }
  if (PROVIDER_CHANNELS.has(ch)) {
    return {
      channel: ch,
      ready: false,
      status: 'not_configured',
      label: `${ch.toUpperCase()} not configured`,
      message: `${ch.toUpperCase()} provider is not configured. Messages will not be marked sent.`
    }
  }
  return {
    channel: ch,
    ready: false,
    status: 'not_configured',
    label: 'Channel not configured',
    message: `Channel "${ch}" has no delivery provider.`
  }
}

export function getAllChannelReadiness() {
  return {
    email: getChannelReadiness('email'),
    sms: getChannelReadiness('sms'),
    whatsapp: getChannelReadiness('whatsapp')
  }
}

async function _getAllTemplates() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_guest_message_templates', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(TEMPLATES_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(TEMPLATES_CACHE)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = new Error(e?.message || 'Failed to load templates; showing cached data')
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

export const getAllTemplates = (...args) => dedupePromise('getAllTemplates', () => _getAllTemplates(...args))

export async function createTemplate(data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_message_template', {
    p_lodge_id: currentLodgeId,
    p_template_key: data.template_key,
    p_name: data.name,
    p_subject_template: data.subject_template || '',
    p_body_template: data.body_template || '',
    p_channel: data.channel || 'email',
    p_variables: data.variables || [],
    p_category: data.category || 'custom'
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not create template')
  return result
}

export async function updateTemplate(id, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_message_template', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_data: data
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update template')
  return result
}

export async function deleteTemplate(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_message_template', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not delete template')
  return result
}

async function _getAllTriggers() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('get_guest_message_triggers', { p_lodge_id: currentLodgeId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(TRIGGERS_CACHE, rows)
    return rows
  } catch (e) {
    const cached = readCache(TRIGGERS_CACHE)
    if (Array.isArray(cached) && cached.length > 0) {
      const err = new Error(e?.message || 'Failed to load triggers; showing cached data')
      err.code = 'STALE_CACHE'
      err.cached = cached
      throw err
    }
    throw e
  }
}

export const getAllTriggers = (...args) => dedupePromise('getAllTriggers', () => _getAllTriggers(...args))

export async function createTrigger(data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('create_message_trigger', {
    p_lodge_id: currentLodgeId,
    p_trigger_event: data.trigger_event,
    p_template_id: data.template_id,
    p_delay_minutes: data.delay_minutes || 0,
    p_channel: data.channel || 'email'
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not create trigger')
  return result
}

export async function updateTrigger(id, data) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('update_message_trigger', {
    p_id: id,
    p_lodge_id: currentLodgeId,
    p_data: data
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not update trigger')
  return result
}

export async function deleteTrigger(id) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data: result, error } = await state.supabase.rpc('delete_message_trigger', {
    p_id: id,
    p_lodge_id: currentLodgeId
  })
  if (error) throw error
  if (result?.success === false) throw new Error(result.error || 'Could not delete trigger')
  return result
}

export async function renderTemplate(templateId, variables) {
  const { data, error } = await state.supabase.rpc('render_message_template', {
    p_template_id: templateId,
    p_variables: variables || {}
  })
  if (error) throw error
  return data
}

export async function queueTriggeredMessages(triggerEvent, variables) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('queue_triggered_messages', {
    p_lodge_id: currentLodgeId,
    p_trigger_event: triggerEvent,
    p_variables: variables || {}
  })
  if (error) throw error
  // Queued is not sent — never rewrite status to sent here.
  return {
    ...(data && typeof data === 'object' ? data : { result: data }),
    delivery_status: 'queued',
    sent: false
  }
}

export async function getDeliveryStatus(status) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  const { data, error } = await state.supabase.rpc('get_message_delivery_status', {
    p_lodge_id: currentLodgeId,
    p_status: status || null
  })
  if (error) throw error
  const rows = Array.isArray(data) ? data : []
  // Annotate non-deliverable provider statuses for the UI — never upgrade status client-side.
  return rows.map((row) => {
    const ch = String(row?.channel || '').toLowerCase()
    const readiness = getChannelReadiness(ch)
    const statusValue = String(row?.status || '').toLowerCase()
    let displayStatus = row?.status
    let readinessNote = null
    if (!readiness.ready && (statusValue === 'queued' || statusValue === 'draft' || statusValue === 'pending')) {
      displayStatus = statusValue === 'draft' ? 'draft' : 'queued'
      readinessNote = readiness.message
    }
    // If a row somehow claims "sent" without provider confirmation capability, demote display only.
    if (!readiness.ready && (statusValue === 'sent' || statusValue === 'delivered')) {
      displayStatus = 'not_configured'
      readinessNote = readiness.message
    }
    return {
      ...row,
      display_status: displayStatus,
      channel_ready: readiness.ready,
      readiness_note: readinessNote
    }
  })
}

/**
 * Attempt to deliver a single queued message.
 * Only marks "sent" after the email provider confirms.
 * SMS/WhatsApp always return not_configured and never mark sent.
 */
export async function dispatchMessage(messageId, options = {}) {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  if (!messageId) throw new Error('Message id is required')

  const channel = String(options.channel || 'email').toLowerCase()
  const readiness = getChannelReadiness(channel)

  if (!readiness.ready) {
    return {
      success: false,
      sent: false,
      status: 'not_configured',
      delivery_status: 'not_configured',
      channel,
      error: readiness.message,
      message: readiness.message
    }
  }

  if (channel !== 'email') {
    return {
      success: false,
      sent: false,
      status: 'not_configured',
      delivery_status: 'not_configured',
      channel,
      error: `${channel} provider is not configured`,
      message: `${channel} provider is not configured`
    }
  }

  // Email path — require SMTP confirmation before any "sent" claim.
  let sendResult
  try {
    const nodemailer = require('nodemailer')
    const config = loadEmailConfigSafe()
    if (!config?.host || !config?.user || !config?.pass) {
      return {
        success: false,
        sent: false,
        status: 'not_configured',
        delivery_status: 'not_configured',
        channel: 'email',
        error: 'Email not configured',
        message: 'Email not configured'
      }
    }
    const to = options.to || options.recipient || options.guest_email
    if (!to) {
      return {
        success: false,
        sent: false,
        status: 'failed',
        delivery_status: 'failed',
        channel: 'email',
        error: 'No recipient email',
        message: 'No recipient email'
      }
    }
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: Number(config.port) || 587,
      secure: Number(config.port) === 465,
      auth: { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: config.allow_insecure_tls !== true }
    })
    const info = await transporter.sendMail({
      from: config.from || config.user,
      to: String(to).trim(),
      subject: options.subject || 'Message from property',
      text: options.body || options.text || '',
      html: options.html || undefined
    })
    // Provider confirmation required: messageId or response from nodemailer.
    const confirmed = Boolean(info?.messageId || info?.response)
    if (!confirmed) {
      return {
        success: false,
        sent: false,
        status: 'failed',
        delivery_status: 'failed',
        channel: 'email',
        error: 'Email provider did not confirm delivery',
        message: 'Email provider did not confirm delivery'
      }
    }
    sendResult = { messageId: info.messageId, response: info.response }
  } catch (e) {
    return {
      success: false,
      sent: false,
      status: 'failed',
      delivery_status: 'failed',
      channel: 'email',
      error: e?.message || 'Email send failed',
      message: e?.message || 'Email send failed'
    }
  }

  // Persist delivery status only after provider confirmation.
  try {
    const { data, error } = await state.supabase.rpc('update_message_delivery_status', {
      p_lodge_id: currentLodgeId,
      p_message_id: messageId,
      p_status: 'sent',
      p_provider_ref: sendResult?.messageId || null
    })
    if (error) {
      // Provider confirmed but status write failed — report partial truth, not false "sent" silence.
      return {
        success: true,
        sent: true,
        status: 'sent',
        delivery_status: 'sent',
        channel: 'email',
        provider_ref: sendResult?.messageId || null,
        warning: error.message || 'Could not persist delivery status after provider confirmation',
        provider_confirmed: true
      }
    }
    return {
      success: true,
      sent: true,
      status: 'sent',
      delivery_status: 'sent',
      channel: 'email',
      provider_ref: sendResult?.messageId || null,
      provider_confirmed: true,
      result: data
    }
  } catch (persistErr) {
    return {
      success: true,
      sent: true,
      status: 'sent',
      delivery_status: 'sent',
      channel: 'email',
      provider_ref: sendResult?.messageId || null,
      provider_confirmed: true,
      warning: persistErr?.message || 'Could not persist delivery status after provider confirmation'
    }
  }
}
