import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function buildClient(sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null
  return createClient(url, anonKey, {
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
