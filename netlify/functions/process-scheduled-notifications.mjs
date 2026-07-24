import { getAdminClient, processDueNotifications } from "./_shared/backend.mjs";

export default async function handler() {
  const supabase = getAdminClient();
  const result = await processDueNotifications(supabase, { batchSize: 10 });
  console.log(JSON.stringify({ level: "info", event: "netlify_scheduled_push_processor", ...result }));
}

export const config = {
  schedule: "* * * * *"
};

