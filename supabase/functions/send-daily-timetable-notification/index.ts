import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TIMETABLE_NOTIFY_TO_DEFAULT = "timetable@hkit.edu.hk";

interface NotifyBody {
  academicYear: string;
  term: string;
  moduleInstanceCode: string;
  programmeCode: string;
  changedBy?: string | null;
  changeSummary: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: NotifyBody;

  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const changeSummary = String(body.changeSummary ?? "").trim();

  if (!changeSummary) {
    return jsonResponse({ error: "changeSummary is required" }, 400);
  }

  const subject = [
    "Daily timetable changes",
    body.academicYear,
    body.term,
    body.moduleInstanceCode,
  ]
    .filter(Boolean)
    .join(" — ");

  const text = [
    "HKIT Course Management System — Daily Timetable Update",
    "",
    `Academic year: ${body.academicYear}`,
    `Term: ${body.term}`,
    `Module: ${body.moduleInstanceCode}`,
    `Programme: ${body.programmeCode}`,
    body.changedBy ? `Changed by: ${body.changedBy}` : "",
    "",
    "Changes:",
    changeSummary,
    "",
    "—",
    "This is an automated message.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("TIMETABLE_EMAIL_FROM") ??
    "HKIT Timetable <onboarding@resend.dev>";
  const notifyTo =
    Deno.env.get("TIMETABLE_NOTIFY_TO")?.trim() || TIMETABLE_NOTIFY_TO_DEFAULT;

  if (!resendKey) {
    return jsonResponse({
      sent: false,
      skipped: true,
      reason:
        "RESEND_API_KEY is not configured on Supabase Edge Functions. Change log was saved to the database.",
    });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [notifyTo],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    return jsonResponse(
      {
        sent: false,
        error: `Resend API failed (${response.status}): ${detail}`,
      },
      502
    );
  }

  const payload = await response.json();

  return jsonResponse({
    sent: true,
    to: notifyTo,
    providerId: payload.id ?? null,
  });
});
