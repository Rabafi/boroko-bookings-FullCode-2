import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function buildClient(sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'boroko-manager-supabase-auth'
    },
    global: {
      headers: token ? { 'x-boroko-session': token } : {}
    }
  })
}

export let supabase = buildClient()

export function setSupabaseSessionToken(sessionToken) {
  supabase = buildClient(sessionToken)
  return supabase
}

export function clearSupabaseSessionToken() {
  supabase = buildClient()
  return supabase
}

export async function signInWithSupabaseAuth(email, password) {
  const client = buildClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  supabase = client
  return data
}

export async function signOutSupabaseAuth() {
  try {
    await supabase.auth.signOut()
  } catch {
    // Local Tsa Bonno app-session cleanup still handles the logout.
  }
}

export async function sendPasswordResetEmail(email) {
  const redirectTo = import.meta.env.VITE_AUTH_REDIRECT_URL || `${window.location.origin}/reset-password`
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw error
  return data
}

export async function updateSupabasePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  return data
}
