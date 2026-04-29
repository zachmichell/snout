// Send transactional email via Resend
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  to: string;
  subject: string;
  html_body: string;
  from_name?: string;
  organization_id?: string;
  email_type?: string;
}

const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const body = (await req.json()) as Payload;

    if (!isEmail(body.to)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid 'to' email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.subject || typeof body.subject !== "string" || body.subject.length > 250) {
      return new Response(JSON.stringify({ success: false, error: "Invalid 'subject'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.html_body || typeof body.html_body !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Invalid 'html_body'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // TODO: switch from onboarding@resend.dev to noreply@snout.app once domain verified
    const fromName = (body.from_name || "Snout.app").replace(/[<>"]/g, "").slice(0, 80);
    const fromAddress = `${fromName} <onboarding@resend.dev>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [body.to],
        subject: body.subject,
        html: body.html_body,
      }),
    });

    const resendData = await resendRes.json().catch(() => ({}));
    const ok = resendRes.ok;
    const messageId = (resendData as any)?.id ?? null;
    const errorMsg = ok ? null : ((resendData as any)?.message ?? `HTTP ${resendRes.status}`);

    // Log if org provided (service role bypasses RLS)
    if (body.organization_id) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("email_log").insert({
        organization_id: body.organization_id,
        recipient_email: body.to,
        email_type: body.email_type ?? "other",
        subject: body.subject,
        status: ok ? "sent" : "failed",
        error_message: errorMsg,
        message_id: messageId,
      });
    }

    if (!ok) {
      return new Response(JSON.stringify({ success: false, error: errorMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, message_id: messageId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const errorId = crypto.randomUUID().slice(0, 8);
    console.error(`send-email error [${errorId}]:`, err);
    return new Response(JSON.stringify({ success: false, error: "Internal error", error_id: errorId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
