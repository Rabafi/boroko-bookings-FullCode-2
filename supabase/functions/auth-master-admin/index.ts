/**
 * auth-master-admin
 *
 * Validates master admin credentials from the Command Central `master_admins` table,
 * then creates a Supabase Auth user (if missing) so the client can obtain a real
 * Supabase Auth session. This lets the web CRM use the same email/password as
 * Command Central.
 *
 * Required Supabase secrets:
 *   SUPABASE_URL               – your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  – service role key (set automatically in Edge runtime)
 */

import bcryptjs from 'npm:bcryptjs@2.4.3'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization'
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

async function verifyMasterAdmin(supabase: any, email: string, password: string) {
  const cleanEmail = email.toLowerCase().trim()
  console.log('[auth-master-admin] checking master_admin:', cleanEmail)

  const { data: admin, error } = await supabase
    .from('master_admins')
    .select('id, email, password_hash, name')
    .eq('email', cleanEmail)
    .single()

  if (error) {
    console.error('[auth-master-admin] query error:', error)
    return { valid: false, reason: 'User not found in master_admins' }
  }

  if (!admin) {
    console.log('[auth-master-admin] no admin found for:', cleanEmail)
    return { valid: false, reason: 'User not found in master_admins' }
  }

  console.log('[auth-master-admin] admin found, comparing hash')


  const match = bcryptjs.compareSync(password, admin.password_hash)

  if (!match) {
    console.log('[auth-master-admin] password mismatch')
    return { valid: false, reason: 'Password does not match' }
  }

  console.log('[auth-master-admin] password match')
  return { valid: true, admin: { id: admin.id, email: admin.email, name: admin.name } }
}

async function ensureAuthUser(supabase: any, email: string, password: string) {
  // Check if the user already exists in Supabase Auth
  const { data: existing } = await supabase.auth.admin.listUsers()
  const found = existing?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())

  if (found) {
    // Update password to match current master admin password
    const { error } = await supabase.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true
    })
    if (error) {
      console.error('[auth-master-admin] update password error:', error)
      return { id: found.id, email: found.email }
    }
    return { id: found.id, email: found.email }
  }

  // Create new Supabase Auth user
  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { is_master_admin: true, source: 'command_central' }
  })

  if (error || !newUser?.user) {
    console.error('[auth-master-admin] create user error:', error)
    return null
  }

  return { id: newUser.user.id, email: newUser.user.email }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400)
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Step 1: Verify master admin credentials
    const { valid, admin, reason } = await verifyMasterAdmin(supabase, email, password)
    if (!valid) {
      return jsonResponse({ error: reason }, 401)
    }

    // Step 2: Ensure a Supabase Auth user exists with matching credentials
    const authUser = await ensureAuthUser(supabase, email, password)
    if (!authUser) {
      return jsonResponse({ error: 'Could not prepare auth session' }, 500)
    }

    // Step 3: Return success — client will sign in via Supabase Auth
    return jsonResponse({
      success: true,
      email: admin?.email,
      name: admin?.name,
      auth_user_id: authUser.id
    })
  } catch (err) {
    console.error('[auth-master-admin] error:', err)
    return jsonResponse({ error: (err as Error)?.message || 'Authentication failed' }, 500)
  }
})
