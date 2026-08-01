// Generates a complete, standalone lead-gen quiz (questions, branching, scoring, result copy) from
// a short offer brief, using the same architecture as the hand-built sales-conversion-quiz: a
// self-contained HTML page with client-side scoring, posting leads to the generic quiz-submit
// function. Deliberately gated (verify_jwt: true) since this is an authoring tool that spends real
// Claude API credits and writes new quiz_configs rows — not a public visitor-facing form.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";
const ANTHROPIC_API_KEY =
  Deno.env.get("ANTHROPIC_API_KEY") ??
  Deno.env.get("CLAUDE_API_KEY") ??
  "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ??
  Deno.env.get("CLAUDE_MODEL") ??
  "claude-sonnet-5";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MID_SCORE = 5;
const HIGH_SCORE = 10;
const QUALIFY_HIGH_SCORE = 15; // matches the weight sales-conversion-quiz gives its own qualifying question

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type Brief = {
  quiz_id: string;
  quiz_title: string;
  niche: string;
  audience: string;
  product: string;
  price: number;
  pain: string[];
  desire: string[];
  tone: string;
  num_scored_questions: number;
  cta_label: string;
  cta_url: string;
  hot_threshold: number;
  warm_threshold: number;
  dry_run: boolean;
};

type GeneratedOption = { text: string; score: number; action: "continue" | "nurture" | "content" | null };
type GeneratedQuestion = { text: string; qualifying: boolean; options: GeneratedOption[] };
type ResultCopy = { title: string; text: string };
type GeneratedQuiz = {
  title: string;
  subtitle: string;
  questions: GeneratedQuestion[];
  results: { hot: ResultCopy; warm: ResultCopy; cold: ResultCopy; nurture: ResultCopy; content: ResultCopy };
};

function jsonResponse(body: JsonValue, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe to embed inside a <script> tag: JSON.stringify already escapes quotes/backslashes; the
// extra `<` escape prevents a generated string containing "</script>" from closing the tag early.
function safeJsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function slugify(value: string, maxLength = 48) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength) || "quiz";
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function containsRiskyClaim(value: string) {
  return /\b(guarantee(d)?|risk-?free|no risk|instant(ly)? results?|100% (proven|certain))\b/i.test(value);
}

function cleanStringArray(value: unknown, { min = 1, max = 8, maxLen = 200 } = {}) {
  if (!Array.isArray(value)) return null;
  const cleaned = value.map((v) => String(v ?? "").trim().slice(0, maxLen)).filter(Boolean);
  if (cleaned.length < min || cleaned.length > max) return null;
  return cleaned;
}

function parseBrief(body: Record<string, unknown>): { brief?: Brief; error?: string } {
  const niche = String(body.niche ?? "").trim().slice(0, 200);
  const audience = String(body.audience ?? "").trim().slice(0, 200);
  const product = String(body.product ?? "").trim().slice(0, 200);
  const price = Number(body.price);
  const pain = cleanStringArray(body.pain, { min: 2, max: 6 });
  const desire = cleanStringArray(body.desire, { min: 2, max: 6 });
  const ctaUrl = String(body.cta_url ?? "").trim();
  const numQuestions = Number.isInteger(body.num_scored_questions) ? Number(body.num_scored_questions) : 7;
  const hotThreshold = Number.isInteger(body.hot_threshold) ? Number(body.hot_threshold) : 25;
  const warmThreshold = Number.isInteger(body.warm_threshold) ? Number(body.warm_threshold) : 15;

  if (!niche) return { error: "niche is required." };
  if (!audience) return { error: "audience is required." };
  if (!product) return { error: "product is required." };
  if (!Number.isFinite(price) || price <= 0) return { error: "price must be a positive number." };
  if (!pain) return { error: "pain must be an array of 2-6 short strings." };
  if (!desire) return { error: "desire must be an array of 2-6 short strings." };
  try {
    const parsed = new URL(ctaUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return { error: "cta_url must be a valid http(s) URL." };
  }
  if (numQuestions < 4 || numQuestions > 9) return { error: "num_scored_questions must be between 4 and 9." };
  if (warmThreshold <= 0 || hotThreshold <= warmThreshold) {
    return { error: "hot_threshold must be greater than warm_threshold, both positive." };
  }

  const providedId = body.quiz_id ? String(body.quiz_id).trim().toLowerCase() : "";
  const quizId = providedId && /^[a-z0-9_-]{1,64}$/.test(providedId) ? providedId : slugify(product);

  return {
    brief: {
      quiz_id: quizId,
      quiz_title: cleanStringArray([body.quiz_title], { min: 0, max: 1, maxLen: 120 })?.[0] ?? "",
      niche,
      audience,
      product,
      price,
      pain,
      desire,
      tone: String(body.tone ?? "direct").trim().slice(0, 60) || "direct",
      num_scored_questions: numQuestions,
      cta_label: String(body.cta_label ?? `Book Your Strategy Call - $${price}`).trim().slice(0, 80),
      cta_url: ctaUrl,
      hot_threshold: hotThreshold,
      warm_threshold: warmThreshold,
      dry_run: Boolean(body.dry_run),
    },
  };
}

function buildSystemPrompt(brief: Brief) {
  return [
    "You are a direct-response quiz-funnel copywriter. You generate a short, diagnostic-style lead quiz for a paid offer.",
    "Output ONLY valid JSON matching exactly this shape, no markdown fences, no commentary, no trailing text:",
    "",
    "{",
    '  "title": string,',
    '  "subtitle": string,',
    '  "questions": [',
    "    {",
    '      "text": string,',
    '      "qualifying": boolean,',
    '      "options": [ {"text": string, "score": number, "action": "continue"|"nurture"|"content"|null} ]',
    "    }",
    "  ],",
    '  "results": {',
    '    "hot": {"title": string, "text": string},',
    '    "warm": {"title": string, "text": string},',
    '    "cold": {"title": string, "text": string},',
    '    "nurture": {"title": string, "text": string},',
    '    "content": {"title": string, "text": string}',
    "  }",
    "}",
    "",
    "Rules:",
    `- Produce exactly ${brief.num_scored_questions} questions in "questions", each with exactly 3 options.`,
    '- Exactly ONE question must have "qualifying": true, asking about timeline, budget, or readiness to invest ' +
      "(not about their pain). Its 3 options must each set \"action\" to \"continue\", \"nurture\", and \"content\" " +
      `(one of each), with scores ${QUALIFY_HIGH_SCORE} (continue), ${MID_SCORE} (nurture), 0 (content).`,
    `- Every other question must have "qualifying": false and "action": null on all 3 options, with scores using ` +
      `only 0, ${MID_SCORE}, and ${HIGH_SCORE} — one of each per question, no repeats within a question.`,
    "- Each result's \"text\" must be 25 to 60 words, second person, concrete, no clinical or diagnostic language, " +
      "no guaranteed-results or guaranteed-income claims, no fabricated statistics, no em dashes.",
    "- Base every question and result strictly on the brief below. Do not invent facts about the business beyond what's given.",
    "",
    `Brief: niche="${brief.niche}", audience="${brief.audience}", product="${brief.product}", price=${brief.price}, ` +
      `tone="${brief.tone}", pain_points=${JSON.stringify(brief.pain)}, desire_points=${JSON.stringify(brief.desire)}` +
      (brief.quiz_title ? `, suggested_title="${brief.quiz_title}"` : ""),
  ].join("\n");
}

function validateGenerated(brief: Brief, data: unknown): { quiz?: GeneratedQuiz; error?: string } {
  if (!data || typeof data !== "object") return { error: "response was not a JSON object" };
  const d = data as Record<string, unknown>;
  const title = String(d.title ?? "").trim();
  const subtitle = String(d.subtitle ?? "").trim();
  if (!title) return { error: "missing title" };
  if (!subtitle) return { error: "missing subtitle" };

  if (!Array.isArray(d.questions) || d.questions.length !== brief.num_scored_questions) {
    return { error: `expected exactly ${brief.num_scored_questions} questions` };
  }

  let qualifyingCount = 0;
  const questions: GeneratedQuestion[] = [];
  for (const raw of d.questions) {
    const q = raw as Record<string, unknown>;
    const text = String(q.text ?? "").trim();
    if (!text) return { error: "a question is missing text" };
    if (!Array.isArray(q.options) || q.options.length !== 3) return { error: `question "${text}" must have exactly 3 options` };
    const qualifying = Boolean(q.qualifying);
    if (qualifying) qualifyingCount++;

    const options: GeneratedOption[] = [];
    const seenScores = new Set<number>();
    const seenActions = new Set<string>();
    for (const rawOpt of q.options) {
      const o = rawOpt as Record<string, unknown>;
      const optText = String(o.text ?? "").trim();
      const score = Number(o.score);
      const action = o.action === "continue" || o.action === "nurture" || o.action === "content" ? o.action : null;
      if (!optText) return { error: `an option in question "${text}" is missing text` };
      if (!Number.isFinite(score)) return { error: `an option in question "${text}" has an invalid score` };
      if (qualifying) {
        if (!action) return { error: `qualifying question "${text}" has an option missing a valid action` };
        seenActions.add(action);
      } else {
        if (action) return { error: `non-qualifying question "${text}" must not set an action` };
        if (![0, MID_SCORE, HIGH_SCORE].includes(score)) {
          return { error: `question "${text}" option score must be one of 0/${MID_SCORE}/${HIGH_SCORE}` };
        }
      }
      if (seenScores.has(score)) return { error: `question "${text}" repeats a score across options` };
      seenScores.add(score);
      options.push({ text: optText, score, action });
    }
    if (qualifying && (seenActions.size !== 3)) {
      return { error: `qualifying question "${text}" must use each of continue/nurture/content exactly once` };
    }
    questions.push({ text, qualifying, options });
  }
  if (qualifyingCount !== 1) return { error: `expected exactly 1 qualifying question, got ${qualifyingCount}` };

  const results = d.results as Record<string, unknown> | undefined;
  const resultKeys = ["hot", "warm", "cold", "nurture", "content"] as const;
  const parsedResults: Record<string, ResultCopy> = {};
  for (const key of resultKeys) {
    const r = results?.[key] as Record<string, unknown> | undefined;
    const rTitle = String(r?.title ?? "").trim();
    const rText = String(r?.text ?? "").trim();
    if (!rTitle || !rText) return { error: `results.${key} is missing title/text` };
    const wc = wordCount(rText);
    if (wc < 25 || wc > 60) return { error: `results.${key}.text must be 25-60 words, got ${wc}` };
    if (containsRiskyClaim(rText)) return { error: `results.${key}.text contains a risky/guaranteed-results claim` };
    parsedResults[key] = { title: rTitle, text: rText };
  }

  return {
    quiz: {
      title,
      subtitle,
      questions,
      results: parsedResults as GeneratedQuiz["results"],
    },
  };
}

async function callClaude(brief: Brief, attempt = 1): Promise<GeneratedQuiz> {
  if (!ANTHROPIC_API_KEY) throw new Error("Claude API key is not configured.");
  const systemPrompt = buildSystemPrompt(brief) + (attempt > 1 ? "\n\nThis is a retry because the first response failed validation. Follow every rule exactly." : "");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate the quiz JSON now." }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude call failed with ${res.status}: ${text.slice(0, 180)}`);
  }
  const payload = await res.json();
  const text = Array.isArray(payload.content)
    ? payload.content.map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text ?? "" : "")).join(" ")
    : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    if (attempt < 2) return callClaude(brief, attempt + 1);
    throw new Error("Claude did not return valid JSON.");
  }

  const { quiz, error } = validateGenerated(brief, parsed);
  if (error || !quiz) {
    if (attempt < 2) return callClaude(brief, attempt + 1);
    throw new Error(`Generated quiz failed validation: ${error}`);
  }
  return quiz;
}

function buildConfig(brief: Brief, quiz: GeneratedQuiz) {
  return {
    meta: {
      quiz_id: brief.quiz_id,
      title: quiz.title,
      niche: brief.niche,
      audience: brief.audience,
      product: brief.product,
      price: brief.price,
    },
    scoring: {
      method: "sum_points",
      note: "Scoring and result classification happen client-side in the generated HTML, not server-side. This row documents that model and satisfies the quiz_submissions foreign key.",
      thresholds: { hot: brief.hot_threshold, warm: brief.warm_threshold },
      early_exit_actions: { continue: "continue", nurture: "nurture", content: "content" },
    },
    questions: quiz.questions,
    results: quiz.results,
    cta: { label: brief.cta_label, url: brief.cta_url },
  };
}

async function sbFetch(path: string, init: RequestInit = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase is not configured.");
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function quizIdExists(quizId: string): Promise<boolean> {
  const res = await sbFetch(`quiz_configs?quiz_id=eq.${quizId}&select=quiz_id&limit=1`);
  if (!res.ok) throw new Error(`quiz_configs lookup failed with ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertConfig(brief: Brief, config: Record<string, unknown>) {
  const res = await sbFetch("quiz_configs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quiz_id: brief.quiz_id, title: config.meta && (config.meta as Record<string, unknown>).title, active: true, config }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`quiz_configs insert failed with ${res.status}: ${text.slice(0, 180)}`);
  }
}

function renderQuizHtml(brief: Brief, quiz: GeneratedQuiz, submitUrl: string) {
  const questions: JsonValue[] = quiz.questions.map((q) => ({
    text: q.text,
    options: q.options.map((o) => ({ text: o.text, score: o.score, action: o.action })),
  }));
  questions.push({ text: "What's your first name?", type: "input", field: "name", placeholder: "First name" });
  questions.push({ text: "What's your best email for your personalized diagnostic?", type: "input", field: "email", placeholder: "your@email.com" });

  const resultCopy = {
    hot: { emoji: "\u{1F525}", ...quiz.results.hot },
    warm: { emoji: "⚡", ...quiz.results.warm },
    cold: { emoji: "\u{1F4DA}", ...quiz.results.cold },
    nurture: { emoji: "\u{1F4E7}", ...quiz.results.nurture },
    content: { emoji: "\u{1F4D6}", ...quiz.results.content },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${htmlEscape(quiz.title)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { font-size: 28px; margin-bottom: 5px; color: #2c3e50; }
        .subtitle { color: #666; font-size: 16px; margin-bottom: 10px; }
        .progress-bar { height: 6px; background: #e0e0e0; border-radius: 3px; margin-bottom: 30px; overflow: hidden; }
        .progress-fill { height: 100%; background: #667eea; width: 0%; transition: width 0.3s; }
        .question { display: none; }
        .question.active { display: block; }
        .question h3 { font-size: 20px; margin-bottom: 20px; color: #2c3e50; }
        .option { display: block; padding: 16px; margin: 10px 0; background: #f8f9fa; border-radius: 8px; cursor: pointer; border: 2px solid transparent; }
        .option:hover { background: #e9ecef; border-color: #667eea; }
        input { width: 100%; padding: 15px; margin: 10px 0; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; }
        button { width: 100%; padding: 16px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 15px; }
        button:hover { background: #5a6fd6; }
        .result { display: none; padding: 30px; background: #f8f9fa; border-radius: 12px; margin-top: 20px; }
        .result.active { display: block; }
        .cta-button { display: block; padding: 18px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; text-align: center; font-size: 18px; font-weight: bold; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${htmlEscape(quiz.title)}</h1>
        <p class="subtitle">${htmlEscape(quiz.subtitle)}</p>

        <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>

        <div id="quiz-container"></div>
        <div id="result-container"></div>
    </div>

    <script>
const quizData = { questions: ${safeJsonForScript(questions)} };
const RESULT_COPY = ${safeJsonForScript(resultCopy)};
const THRESHOLDS = ${safeJsonForScript({ hot: brief.hot_threshold, warm: brief.warm_threshold })};
const CTA = ${safeJsonForScript({ label: brief.cta_label, url: brief.cta_url })};
const QUIZ_ID = ${safeJsonForScript(brief.quiz_id)};
const SUBMIT_URL = ${safeJsonForScript(submitUrl)};

let currentQuestion = 0;
let answers = [];
let totalScore = 0;
let userAction = 'continue';

// Question/option/result text originates from an LLM generation step, not hand-authored copy —
// escape it before it goes into innerHTML so it can only ever render as text, never as markup.
function esc(value) {
    const div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
}

function init() { renderQuestion(); updateProgress(); }

function renderQuestion() {
    const container = document.getElementById('quiz-container');
    const question = quizData.questions[currentQuestion];
    if (!question) { showResult(); return; }

    let html = '<div class="question active">';
    html += '<h3>Q' + (currentQuestion + 1) + ': ' + esc(question.text) + '</h3>';

    if (question.type === 'input') {
        html += '<input type="' + (question.field === 'email' ? 'email' : 'text') + '" id="' + question.field + '" placeholder="' + esc(question.placeholder) + '">';
        html += '<button onclick="handleInput()">' + (question.field === 'email' ? 'Get My Result' : 'Continue') + '</button>';
    } else {
        question.options.forEach((opt, idx) => {
            html += '<div class="option" onclick="handleOption(' + idx + ')">' + esc(opt.text) + '</div>';
        });
    }
    html += '</div>';
    container.innerHTML = html;
}

function handleOption(optionIndex) {
    const question = quizData.questions[currentQuestion];
    const option = question.options[optionIndex];

    answers.push({ question: currentQuestion + 1, answer: option.text, score: option.score || 0 });

    if (option.score) totalScore += option.score;
    if (option.action) userAction = option.action;

    if (option.action === 'content' || option.action === 'nurture') { showResult(); return; }

    currentQuestion++;
    renderQuestion();
    updateProgress();
}

function handleInput() {
    const question = quizData.questions[currentQuestion];
    const input = document.getElementById(question.field);
    if (!input || !input.value.trim()) return;

    answers.push({ question: currentQuestion + 1, answer: input.value, field: question.field });

    if (question.field === 'email') { showResult(); }
    else { currentQuestion++; renderQuestion(); updateProgress(); }
}

function updateProgress() {
    const progress = (currentQuestion / quizData.questions.length) * 100;
    document.getElementById('progress').style.width = progress + '%';
}

function showResult() {
    document.getElementById('quiz-container').style.display = 'none';
    document.getElementById('progress').style.width = '100%';

    let resultType = '';
    if (userAction === 'content') resultType = 'content';
    else if (userAction === 'nurture') resultType = 'nurture';
    else if (totalScore >= THRESHOLDS.hot) resultType = 'hot';
    else if (totalScore >= THRESHOLDS.warm) resultType = 'warm';
    else resultType = 'cold';

    const copy = RESULT_COPY[resultType];
    const container = document.getElementById('result-container');
    let html = '<div class="result active">';
    html += '<h2>' + copy.emoji + ' ' + esc(copy.title) + '</h2>';
    html += '<p>Score: ' + totalScore + ' points</p>';
    html += '<p>' + esc(copy.text) + '</p>';
    if (resultType === 'hot') {
        html += '<a href="' + encodeURI(CTA.url) + '" class="cta-button">' + esc(CTA.label) + '</a>';
    }
    html += '</div>';
    container.innerHTML = html;

    storeLead(resultType, copy.title, copy.text).catch(err => console.error('Store lead error:', err));
}

async function sendToSupabase(leadData) {
    const payload = {
        quiz_id: QUIZ_ID,
        first_name: leadData.name,
        email: leadData.email,
        primary_result: leadData.result,
        score: leadData.score,
        answers: answers.filter(a => !a.field),
        result_title: leadData.resultTitle,
        result_text: leadData.resultText,
        page_url: window.location.href
    };
    try {
        const response = await fetch(SUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return response.ok;
    } catch (error) {
        console.error('Network error:', error);
        return false;
    }
}

async function storeLead(resultType, resultTitle, resultText) {
    const nameInput = answers.find(a => a.field === 'name');
    const emailInput = answers.find(a => a.field === 'email');
    if (!emailInput || !emailInput.answer) return;

    const lead = { name: nameInput ? nameInput.answer : 'Anonymous', email: emailInput.answer, result: resultType, resultTitle, resultText, score: totalScore, date: new Date().toISOString() };
    const synced = await sendToSupabase(lead);

    const leads = JSON.parse(localStorage.getItem('quiz_leads') || '[]');
    leads.push({ ...lead, synced });
    localStorage.setItem('quiz_leads', JSON.stringify(leads));

    const container = document.getElementById('result-container');
    const confirmation = document.createElement('div');
    confirmation.style.cssText = 'margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 8px; color: #155724;';
    confirmation.textContent = synced ? 'Your result has been saved. Check your email for next steps.' : 'Result saved. We will follow up shortly.';
    container.appendChild(confirmation);
}

init();
    </script>
</body>
</html>
`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: "Server is not configured." }, 500);

  try {
    const body = await req.json();
    const { brief, error } = parseBrief(body);
    if (error || !brief) return jsonResponse({ error }, 400);

    if (!brief.dry_run && (await quizIdExists(brief.quiz_id))) {
      return jsonResponse({ error: `quiz_id "${brief.quiz_id}" already exists. Pass a different quiz_id.` }, 409);
    }

    const quiz = await callClaude(brief);
    const config = buildConfig(brief, quiz);

    if (!brief.dry_run) {
      await insertConfig(brief, config);
    }

    const submitUrl = `${SUPABASE_URL}/functions/v1/quiz-submit`;
    const html = renderQuizHtml(brief, quiz, submitUrl);

    return jsonResponse({
      ok: true,
      dry_run: brief.dry_run,
      quiz_id: brief.quiz_id,
      config,
      html,
      deploy_hint: "Save `html` as quiz.html (and optionally index.html), then deploy to Vercel/Netlify. It posts leads to the quiz-submit function automatically.",
    });
  } catch (error) {
    console.error("quiz-generate failed", error);
    const message = error instanceof Error ? error.message : "Generation failed.";
    return jsonResponse({ error: message }, 500);
  }
});
