import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — bypasses all RLS.
 * ONLY use server-side (Server Components, Server Actions, Route Handlers).
 * NEVER import in client components.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (find it in Supabase → Settings → API).'
    )
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
