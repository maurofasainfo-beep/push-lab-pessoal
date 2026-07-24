import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AdminClient = SupabaseClient;

export function adminClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    throw new Error("SUPABASE_ADMIN_CONFIG_MISSING");
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
