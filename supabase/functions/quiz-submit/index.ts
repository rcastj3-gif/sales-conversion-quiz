// Generic lead-capture endpoint for any quiz built on the quiz_configs/quiz_submissions engine.
// Unlike sales-quiz-submit (which is hardcoded to one quiz), this takes quiz_id from the request
// and only requires that an active quiz_configs row exists for it. No email send, no mailing-list
// subscription, no contacts/remembrance linking — same narrow scope as sales-quiz-submit, just
// reusable across quizzes instead of one deployed function per quiz.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";

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
function cleanQuizId(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(text) ? text : "";
}
function cleanResultSlug(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(text) ? text : "";
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

async function quizIsActive(quizId: string): Promise<boolean> {
  const res = await sbFetch(`quiz_configs?quiz_id=eq.${quizId}&active=eq.true&select=quiz_id&limit=1`);
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function rateCheck(quizId: string, ip: string): Promise<boolean> {
  const res = await sbFetch("rpc/quiz_rate_check", { method: "POST", body: JSON.stringify({ p_quiz_id: quizId, p_ip: ip }) });
  if (!res.ok) return true; // fail open — a broken rate check should not block real leads
  return (await res.json()) === true;
}

async function insertSubmission(quizId: string, firstName: string, email: string, body: Record<string, unknown>, req: Request) {
  const primaryResult = cleanResultSlug(body.primary_result) || "unscored";
  const secondaryResult = body.secondary_result ? cleanResultSlug(body.secondary_result) || null : null;
  const score = Number(body.score);
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const pageUrl = cleanText(body.page_url, 1000) || null;

  const row = {
    quiz_id: quizId,
    first_name: firstName,
    email,
    primary_result: primaryResult,
    secondary_result: secondaryResult,
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
    const quizId = cleanQuizId(body.quiz_id);
    const firstName = cleanText(body.first_name, 80);
    const email = cleanEmail(body.email);

    if (!quizId) return jsonResponse({ error: "A valid quiz_id is required." }, 400);
    if (!firstName) return jsonResponse({ error: "First name is required." }, 400);
    if (!validEmail(email)) return jsonResponse({ error: "Valid email is required." }, 400);

    if (!(await quizIsActive(quizId))) {
      return jsonResponse({ error: `Unknown or inactive quiz_id: ${quizId}` }, 404);
    }

    const ip = clientIp(req);
    const allowed = await rateCheck(quizId, ip);
    if (!allowed) return jsonResponse({ error: "Too many submissions. Please try again later." }, 429);

    const submission = await insertSubmission(quizId, firstName, email, body, req);

    return jsonResponse({ ok: true, submission_id: submission.id, share_ref: submission.share_ref });
  } catch (error) {
    console.error("quiz-submit failed", error);
    const message = error instanceof Error ? error.message : "Submission failed.";
    return jsonResponse({ error: message }, 500);
  }
});
