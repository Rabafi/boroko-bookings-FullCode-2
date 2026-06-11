/**
 * send-booking-confirmation
 *
 * Triggered by the booking-site after a successful create_online_booking RPC call.
 * Fetches booking details from the DB using service role, then sends a
 * confirmation email to the guest via SMTP (Nodemailer-compatible).
 *
 * Required Supabase secrets:
 *   SUPABASE_URL               – your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  – service role key (set automatically in Edge runtime)
 *   SMTP_HOST                  – e.g. smtp.gmail.com
 *   SMTP_PORT                  – e.g. 587
 *   SMTP_USER                  – sender email address
 *   SMTP_PASS                  – sender email password / app password
 *   SMTP_FROM_NAME             – display name, e.g. "Boroko Bookings"
 *   BOOKING_FUNCTION_SECRET    – optional server-to-server override secret
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SMTP_HOST    = Deno.env.get('SMTP_HOST') || ''
const SMTP_PORT    = parseInt(Deno.env.get('SMTP_PORT') || '587')
const SMTP_USER    = Deno.env.get('SMTP_USER') || ''
const SMTP_PASS    = Deno.env.get('SMTP_PASS') || ''
const FROM_NAME    = Deno.env.get('SMTP_FROM_NAME') || 'Boroko Bookings'
const FUNCTION_SECRET = Deno.env.get('BOOKING_FUNCTION_SECRET') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-boroko-function-secret'
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function hasFunctionSecret(req: Request) {
  return Boolean(FUNCTION_SECRET && req.headers.get('x-boroko-function-secret') === FUNCTION_SECRET)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanHeaderValue(value: unknown) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function safeErrorMessage(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null
}

async function recordBookingEmailEvent(
  supabase: any,
  context: Record<string, unknown>,
  status: string,
  details: Record<string, unknown> = {}
) {
  if (!supabase) return
  try {
    const metadata = {
      source: 'send-booking-confirmation',
      ...(details.metadata && typeof details.metadata === 'object' ? details.metadata as Record<string, unknown> : {})
    }
    const { error } = await supabase.rpc('record_booking_email_delivery', {
      p_lodge_id: isUuid(context.lodge_id) ? context.lodge_id : null,
      p_booking_id: isUuid(context.booking_id) ? context.booking_id : null,
      p_reference: context.reference || null,
      p_delivery_status: status,
      p_recipient: context.recipient || null,
      p_error_message: safeErrorMessage(details.error_message),
      p_metadata: metadata
    })
    if (error) {
      console.error('[send-booking-confirmation] delivery log error:', error)
    }
  } catch (err) {
    console.error('[send-booking-confirmation] delivery log failed:', err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  let supabase: any = null
  const logContext: Record<string, unknown> = {}

  try {
    const { booking_id, guest_email, confirmation_token } = await req.json()
    logContext.booking_id = booking_id

    if (!booking_id) {
      return jsonResponse({ error: 'booking_id is required' }, 400)
    }
    if (!guest_email) {
      return jsonResponse({ error: 'guest_email is required' }, 400)
    }

    // Fetch booking details using service role (bypasses RLS)
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select(`
        id,
        lodge_id,
        check_in,
        check_out,
        adults,
        children,
        total_amount,
        notes,
        source,
        create_idempotency_key,
        online_confirmation_token,
        rooms ( room_number, room_type ),
        customers ( first_name, last_name, email, phone )
      `)
      .eq('id', booking_id)
      .single()

    if (fetchError || !booking) {
      console.error('Booking fetch error:', fetchError)
      await recordBookingEmailEvent(supabase, logContext, 'booking_not_found', {
        error_message: fetchError?.message || 'Booking not found'
      })
      return jsonResponse({ error: 'Booking not found' }, 404)
    }

    const reference = 'ONL-' + booking.id.substring(0, 8).toUpperCase()
    logContext.booking_id = booking.id
    logContext.lodge_id = booking.lodge_id
    logContext.reference = reference

    let lodgeName = 'the lodge'
    let lodgePhone = ''
    let lodgeEmail = ''
    if (booking.lodge_id) {
      const { data: settings } = await supabase
        .from('settings')
        .select('lodge_name, company_name, phone, email')
        .eq('lodge_id', booking.lodge_id)
        .single()
      if (settings) {
        lodgeName  = settings.lodge_name || settings.company_name || lodgeName
        lodgePhone = settings.phone || ''
        lodgeEmail = settings.email || ''
      }
    }

    const customerEmail = String(booking.customers?.email || '').trim().toLowerCase()
    const requestedEmail = String(guest_email || '').trim().toLowerCase()
    logContext.recipient = customerEmail || null
    if (!requestedEmail || requestedEmail !== customerEmail) {
      await recordBookingEmailEvent(supabase, logContext, 'guest_mismatch', {
        error_message: 'Guest email did not match booking customer email',
        metadata: { requested_email_present: Boolean(requestedEmail) }
      })
      return jsonResponse({ error: 'Guest email does not match booking' }, 403)
    }

    const requestedToken = String(confirmation_token || '').trim()
    const storedToken = String(booking.online_confirmation_token || '').trim()
    if (!hasFunctionSecret(req) && (!requestedToken || !storedToken || requestedToken !== storedToken)) {
      await recordBookingEmailEvent(supabase, logContext, 'token_invalid', {
        error_message: 'Confirmation token missing or invalid',
        metadata: {
          token_present: Boolean(requestedToken),
          stored_token_present: Boolean(storedToken),
          server_override: false
        }
      })
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const toEmail = booking.customers?.email
    if (!toEmail) {
      await recordBookingEmailEvent(supabase, logContext, 'failed', {
        error_message: 'No guest email available'
      })
      return jsonResponse({ error: 'No guest email available' }, 422)
    }

    const guestName = [booking.customers?.first_name, booking.customers?.last_name].filter(Boolean).join(' ') || 'Guest'
    const nights    = Math.max(1, Math.ceil((new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000))
    const safeLodgeName = escapeHtml(lodgeName)
    const safeGuestName = escapeHtml(guestName)
    const safeRoomNumber = escapeHtml(booking.rooms?.room_number || '—')
    const safeRoomType = escapeHtml(booking.rooms?.room_type || '—')
    const safeCheckIn = escapeHtml(booking.check_in)
    const safeCheckOut = escapeHtml(booking.check_out)
    const safeReference = escapeHtml(reference)
    const safeLodgePhone = escapeHtml(lodgePhone)
    const safeLodgeEmail = escapeHtml(lodgeEmail)
    const safeTotal = escapeHtml(Number(booking.total_amount || 0).toLocaleString())

    // Build email body
    const subject = cleanHeaderValue(`Booking Request Received — ${lodgeName} (${reference})`)

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#fafaf9;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4;">
    <div style="background:#059669;padding:32px 32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">Booking Request Received</h1>
      <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px;">${safeLodgeName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1c1917;font-size:15px;margin:0 0 20px;">
        Dear ${safeGuestName},<br><br>
        Thank you for your booking request. <strong>${safeLodgeName}</strong> will review and confirm your reservation within 24 hours.
      </p>

      <div style="background:#f5f5f4;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div style="color:#78716c;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Your Reference</div>
        <div style="font-size:28px;font-weight:bold;color:#1c1917;font-family:monospace;letter-spacing:0.05em;">${safeReference}</div>
        <div style="color:#a8a29e;font-size:11px;margin-top:4px;">Keep this for your records</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Room</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">
            ${safeRoomNumber} (${safeRoomType})
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Check-in</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${safeCheckIn}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Check-out</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${safeCheckOut}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Nights</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${nights}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#78716c;">Estimated Total</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:700;text-align:right;">
            ${safeTotal}
          </td>
        </tr>
      </table>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;font-size:13px;color:#92400e;margin-bottom:20px;">
        <strong>No payment is required now.</strong> The lodge will contact you to confirm your reservation and arrange payment.
      </div>

      <p style="font-size:13px;color:#78716c;margin:0;">
        Questions? Contact ${safeLodgeName} directly:
        ${lodgePhone ? `<br>Phone: ${safeLodgePhone}` : ''}
        ${lodgeEmail ? `<br>Email: ${safeLodgeEmail}` : ''}
      </p>
    </div>
    <div style="background:#f5f5f4;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#a8a29e;margin:0;">Powered by Boroko Bookings</p>
    </div>
  </div>
</body>
</html>`

    // If no SMTP configured, log and return success (allows testing without email)
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.log(`[send-booking-confirmation] SMTP not configured — would send to ${toEmail}`)
      console.log(`Subject: ${subject}`)
      await recordBookingEmailEvent(supabase, logContext, 'smtp_missing', {
        error_message: 'SMTP not configured',
        metadata: { host_present: Boolean(SMTP_HOST), user_present: Boolean(SMTP_USER), pass_present: Boolean(SMTP_PASS) }
      })
      return jsonResponse({ sent: false, reason: 'SMTP not configured' })
    }

    // Send email via SMTP using fetch to a simple relay
    // Uses the Deno SMTP library pattern
    const { SMTPClient } = await import('https://deno.land/x/denomailer@1.6.0/mod.ts')

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER, password: SMTP_PASS }
      }
    })

    await client.send({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to: toEmail,
      subject,
      html
    })

    await client.close()

    await recordBookingEmailEvent(supabase, logContext, 'sent', {
      metadata: { smtp_host: SMTP_HOST, smtp_port: SMTP_PORT }
    })

    if (!hasFunctionSecret(req) && storedToken) {
      await supabase
        .from('bookings')
        .update({ online_confirmation_token: null })
        .eq('id', booking.id)
        .eq('online_confirmation_token', storedToken)
    }

    return jsonResponse({ sent: true, to: toEmail, reference })

  } catch (err) {
    console.error('[send-booking-confirmation] error:', err)
    await recordBookingEmailEvent(supabase, logContext, 'failed', {
      error_message: (err as Error)?.message || 'Booking confirmation email failed'
    })
    return jsonResponse({ error: (err as Error)?.message || 'Booking confirmation email failed' }, 500)
  }
})
