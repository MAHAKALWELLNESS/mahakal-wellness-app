// Supabase Edge Function: send-push
// Sends a web push notification to every subscribed device.
// Deploy via Supabase Dashboard → Edge Functions → Create a new function
// named "send-push" → paste this file's content → Deploy.
// Also set two secrets first (Edge Functions → Manage secrets):
//   VAPID_PUBLIC_KEY  = BF8D3xu3flEF0NiA6DEQhOtYSe19SwHnlUBNI4wjgA9-kZn9PeUyfl8iFvMEBwVyJLUhedzyqBQ4xW1g_dCiLFQ
//   VAPID_PRIVATE_KEY = YrQVEeBRQEfwtqybAC4YefH5uQL-Y3HPMl5DTHzcg8o

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails("mailto:contact@mahakalwellness.example", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { title, body } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title and body are required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
    if (error) throw error;

    const payload = JSON.stringify({ title, body });
    let sent = 0, failed = 0;

    await Promise.all((subs || []).map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
      };
      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err) {
        failed++;
        // Endpoint is gone (user uninstalled/revoked) - clean it up.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }));

    return new Response(JSON.stringify({ sent, failed, total: (subs || []).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
