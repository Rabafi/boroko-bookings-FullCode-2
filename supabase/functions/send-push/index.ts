import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FUNCTION_SECRET   = Deno.env.get('PUSH_FUNCTION_SECRET') || ''

webpush.setVapidDetails('mailto:admin@boroko.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-boroko-function-secret',
  'Content-Type': 'application/json'
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function requireFunctionSecret(req: Request) {
  if (!FUNCTION_SECRET) {
    return jsonResponse({ error: 'Push function is not configured for secure delivery' }, 503)
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

    const { lodge_id, title, body, url = '/#/alerts', tag, dedupeKey, version } = await req.json()
    if (!lodge_id || !title) return jsonResponse({ error: 'lodge_id and title required' }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('lodge_id', lodge_id)

    if (!subs?.length) return jsonResponse({ sent: 0, pruned: 0 })

    const payload = JSON.stringify({ title, body, url, tag, dedupeKey, version })
    const results = await Promise.allSettled(
      subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload))
    )

    // 404 / 410 = subscription is permanently gone (browser unsubscribed or endpoint expired).
    // Delete these immediately so they are never retried.
    const deadEndpoints: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const status = (r.reason as any)?.statusCode
        if (status === 404 || status === 410) deadEndpoints.push(subs[i].endpoint)
      }
    })

    let pruned = 0
    if (deadEndpoints.length > 0) {
      const { count } = await supabase
        .from('push_subscriptions')
        .delete({ count: 'exact' })
        .in('endpoint', deadEndpoints)
      pruned = count ?? deadEndpoints.length
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    const failed = results.length - sent - pruned
    return jsonResponse({ sent, pruned, failed })
  } catch (e) {
    return jsonResponse({ error: e.message }, 500)
  }
})
