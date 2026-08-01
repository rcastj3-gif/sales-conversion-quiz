// Stores a Sales Conversion Diagnostic lead in public.quiz_submissions (quiz_id = "sales-conversion").
// Deliberately narrow: no email send, no mailing-list subscription, no contacts/remembrance linking.
// Those are side effects of a different product's quiz-result function and don't belong here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";

const QUIZ_ID = "sales-conversion";
const VALID_RESULTS = new Set(["hot", "warm", "cold", "nurture", "content"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function jsonResponse(body: JsonValue, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
function cleanEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}
function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "";
}

async function sbFetch(path: string, init: RequestInit = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase is not configured.");
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function rateCheck(ip: string): Promise<boolean> {
  const res = await sbFetch("rpc/sales_quiz_rate_check", { method: "POST", body: JSON.stringify({ p_ip: ip }) });
  if (!res.ok) return true; // fail open — a broken rate check should not block real leads
  return (await res.json()) === true;
}

async function insertSubmission(firstName: string, email: string, body: Record<string, unknown>, req: Request) {
  const primaryResult = VALID_RESULTS.has(String(body.primary_result)) ? String(body.primary_result) : "cold";
  const score = Number(body.score);
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const pageUrl = cleanText(body.page_url, 1000) || null;

  const row = {
    quiz_id: QUIZ_ID,
    first_name: firstName,
    email,
    primary_result: primaryResult,
    secondary_result: null,
    scores: { total: Number.isFinite(score) ? score : 0 },
    answers,
    result_payload: {
      title: cleanText(body.result_title, 200),
      text: cleanText(body.result_text, 1000),
    },
    referral_source: null,
    user_agent: req.headers.get("user-agent"),
    page_url: pageUrl,
  };

  const res = await sbFetch("quiz_submissions?select=id,share_ref,created_at", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submission insert failed with ${res.status}: ${text.slice(0, 180)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error("Submission insert returned no row.");
  return rows[0] as { id: string; share_ref: string; created_at?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: "Server is not configured." }, 500);

  try {
    const body = await req.json();
    const firstName = cleanText(body.first_name, 80);
    const email = cleanEmail(body.email);

    if (!firstName) return jsonResponse({ error: "First name is required." }, 400);
    if (!validEmail(email)) return jsonResponse({ error: "Valid email is required." }, 400);

    const ip = clientIp(req);
    const allowed = await rateCheck(ip);
    if (!allowed) return jsonResponse({ error: "Too many submissions. Please try again later." }, 429);

    const submission = await insertSubmission(firstName, email, body, req);

    return jsonResponse({ ok: true, submission_id: submission.id, share_ref: submission.share_ref });
  } catch (error) {
    console.error("sales-quiz-submit failed", error);
    const message = error instanceof Error ? error.message : "Submission failed.";
    return jsonResponse({ error: message }, 500);
  }
});
