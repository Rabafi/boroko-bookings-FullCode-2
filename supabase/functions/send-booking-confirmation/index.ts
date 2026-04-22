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
 *   BOOKING_FUNCTION_SECRET    – shared secret required in x-boroko-function-secret
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

function requireFunctionSecret(req: Request) {
  if (!FUNCTION_SECRET) {
    return jsonResponse({ error: 'Booking confirmation function is not configured for secure delivery' }, 503)
  }
  if (req.headers.get('x-boroko-function-secret') !== FUNCTION_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authError = requireFunctionSecret(req)
    if (authError) return authError

    const { booking_id, guest_email } = await req.json()

    if (!booking_id) {
      return jsonResponse({ error: 'booking_id is required' }, 400)
    }

    // Fetch booking details using service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select(`
        id,
        check_in,
        check_out,
        adults,
        children,
        total_amount,
        notes,
        source,
        create_idempotency_key,
        rooms ( room_number, room_type ),
        customers ( first_name, last_name, email, phone )
      `)
      .eq('id', booking_id)
      .single()

    if (fetchError || !booking) {
      console.error('Booking fetch error:', fetchError)
      return jsonResponse({ error: 'Booking not found' }, 404)
    }

    // Fetch lodge name from settings via lodge_id in bookings table
    const { data: bookingRaw } = await supabase
      .from('bookings')
      .select('lodge_id')
      .eq('id', booking_id)
      .single()

    let lodgeName = 'the lodge'
    let lodgePhone = ''
    let lodgeEmail = ''
    if (bookingRaw?.lodge_id) {
      const { data: settings } = await supabase
        .from('settings')
        .select('lodge_name, company_name, phone, email')
        .eq('lodge_id', bookingRaw.lodge_id)
        .single()
      if (settings) {
        lodgeName  = settings.lodge_name || settings.company_name || lodgeName
        lodgePhone = settings.phone || ''
        lodgeEmail = settings.email || ''
      }
    }

    const customerEmail = String(booking.customers?.email || '').trim().toLowerCase()
    const requestedEmail = String(guest_email || '').trim().toLowerCase()
    if (requestedEmail && requestedEmail !== customerEmail) {
      return jsonResponse({ error: 'Guest email does not match booking' }, 403)
    }

    const toEmail = booking.customers?.email
    if (!toEmail) {
      return jsonResponse({ error: 'No guest email available' }, 422)
    }

    const guestName = [booking.customers?.first_name, booking.customers?.last_name].filter(Boolean).join(' ') || 'Guest'
    const reference = 'ONL-' + booking.id.substring(0, 8).toUpperCase()
    const nights    = Math.max(1, Math.ceil((new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000))

    // Build email body
    const subject = `Booking Request Received — ${lodgeName} (${reference})`

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#fafaf9;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e7e5e4;">
    <div style="background:#059669;padding:32px 32px 24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">Booking Request Received</h1>
      <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px;">${lodgeName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#1c1917;font-size:15px;margin:0 0 20px;">
        Dear ${guestName},<br><br>
        Thank you for your booking request. <strong>${lodgeName}</strong> will review and confirm your reservation within 24 hours.
      </p>

      <div style="background:#f5f5f4;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center;">
        <div style="color:#78716c;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Your Reference</div>
        <div style="font-size:28px;font-weight:bold;color:#1c1917;font-family:monospace;letter-spacing:0.05em;">${reference}</div>
        <div style="color:#a8a29e;font-size:11px;margin-top:4px;">Keep this for your records</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Room</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">
            ${booking.rooms?.room_number || '—'} (${booking.rooms?.room_type || '—'})
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Check-in</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${booking.check_in}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Check-out</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${booking.check_out}</td>
        </tr>
        <tr style="border-bottom:1px solid #e7e5e4;">
          <td style="padding:10px 0;color:#78716c;">Nights</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:600;text-align:right;">${nights}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#78716c;">Estimated Total</td>
          <td style="padding:10px 0;color:#1c1917;font-weight:700;text-align:right;">
            ${Number(booking.total_amount || 0).toLocaleString()}
          </td>
        </tr>
      </table>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;font-size:13px;color:#92400e;margin-bottom:20px;">
        <strong>No payment is required now.</strong> The lodge will contact you to confirm your reservation and arrange payment.
      </div>

      <p style="font-size:13px;color:#78716c;margin:0;">
        Questions? Contact ${lodgeName} directly:
        ${lodgePhone ? `<br>📞 ${lodgePhone}` : ''}
        ${lodgeEmail ? `<br>✉️ ${lodgeEmail}` : ''}
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

    return jsonResponse({ sent: true, to: toEmail, reference })

  } catch (err) {
    console.error('[send-booking-confirmation] error:', err)
    return jsonResponse({ error: err.message }, 500)
  }
})
