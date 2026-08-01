// Plain-JS mirror of the pure (non-Deno, non-network) logic in supabase/functions/quiz-generate/index.ts,
// used to unit-test it locally since Deno/live HTTP calls aren't reachable from this session.
// Mirrors, not imports -- keep in sync manually if the source changes.

const MID_SCORE = 5;
const HIGH_SCORE = 10;

function wordCount(value) {
  return value.split(/\s+/).filter(Boolean).length;
}

function containsRiskyClaim(value) {
  return /\b(guarantee(d)?|risk-?free|no risk|instant(ly)? results?|100% (proven|certain))\b/i.test(value);
}

function cleanStringArray(value, { min = 1, max = 8, maxLen = 200 } = {}) {
  if (!Array.isArray(value)) return null;
  const cleaned = value.map((v) => String(v ?? "").trim().slice(0, maxLen)).filter(Boolean);
  if (cleaned.length < min || cleaned.length > max) return null;
  return cleaned;
}

function slugify(value, maxLength = 48) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength) || "quiz"
  );
}

function htmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function validateGenerated(brief, data) {
  if (!data || typeof data !== "object") return { error: "response was not a JSON object" };
  const d = data;
  const title = String(d.title ?? "").trim();
  const subtitle = String(d.subtitle ?? "").trim();
  if (!title) return { error: "missing title" };
  if (!subtitle) return { error: "missing subtitle" };

  if (!Array.isArray(d.questions) || d.questions.length !== brief.num_scored_questions) {
    return { error: `expected exactly ${brief.num_scored_questions} questions` };
  }

  let qualifyingCount = 0;
  const questions = [];
  for (const raw of d.questions) {
    const q = raw;
    const text = String(q.text ?? "").trim();
    if (!text) return { error: "a question is missing text" };
    if (!Array.isArray(q.options) || q.options.length !== 3) return { error: `question "${text}" must have exactly 3 options` };
    const qualifying = Boolean(q.qualifying);
    if (qualifying) qualifyingCount++;

    const options = [];
    const seenScores = new Set();
    const seenActions = new Set();
    for (const rawOpt of q.options) {
      const o = rawOpt;
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
    if (qualifying && seenActions.size !== 3) {
      return { error: `qualifying question "${text}" must use each of continue/nurture/content exactly once` };
    }
    questions.push({ text, qualifying, options });
  }
  if (qualifyingCount !== 1) return { error: `expected exactly 1 qualifying question, got ${qualifyingCount}` };

  const results = d.results;
  const resultKeys = ["hot", "warm", "cold", "nurture", "content"];
  const parsedResults = {};
  for (const key of resultKeys) {
    const r = results?.[key];
    const rTitle = String(r?.title ?? "").trim();
    const rText = String(r?.text ?? "").trim();
    if (!rTitle || !rText) return { error: `results.${key} is missing title/text` };
    const wc = wordCount(rText);
    if (wc < 25 || wc > 60) return { error: `results.${key}.text must be 25-60 words, got ${wc}` };
    if (containsRiskyClaim(rText)) return { error: `results.${key}.text contains a risky/guaranteed-results claim` };
    parsedResults[key] = { title: rTitle, text: rText };
  }

  return { quiz: { title, subtitle, questions, results: parsedResults } };
}

// ---- test harness ----
let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// slugify
check('slugify("Sales Conversion System!") === "sales-conversion-system"', slugify("Sales Conversion System!") === "sales-conversion-system");
check('slugify("   ") === "quiz" (fallback on empty)', slugify("   ") === "quiz");
check("slugify caps length", slugify("a".repeat(100), 10).length === 10);

// wordCount / containsRiskyClaim
check("wordCount counts words", wordCount("one two three") === 3);
check("containsRiskyClaim catches 'guaranteed results'", containsRiskyClaim("This is a guaranteed result for you.") === true);
check("containsRiskyClaim catches 'risk-free'", containsRiskyClaim("Totally risk-free offer.") === true);
check("containsRiskyClaim leaves normal text alone", containsRiskyClaim("This will help you close more deals.") === false);

// cleanStringArray
check("cleanStringArray accepts 2-6 items", JSON.stringify(cleanStringArray(["a", "b"], { min: 2, max: 6 })) === '["a","b"]');
check("cleanStringArray rejects too few", cleanStringArray(["a"], { min: 2, max: 6 }) === null);
check("cleanStringArray rejects non-array", cleanStringArray("not an array", { min: 2, max: 6 }) === null);

// htmlEscape / safeJsonForScript
check('htmlEscape escapes <script>', htmlEscape('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');
check(
  "safeJsonForScript neutralizes </script> breakout",
  !safeJsonForScript({ text: "</script><script>alert(1)</script>" }).includes("</script>")
);

// validateGenerated — build a valid 3-question sample (1 qualifying + 2 normal) and check both accept and reject paths
const brief = { num_scored_questions: 3 };
const validResult = (n) => ({
  title: `Result ${n}`,
  text:
    "You are doing well but there is real room to grow here, and a clear next step waiting for you to take " +
    "today. Momentum comes from small consistent action, not from waiting until everything feels perfectly ready.",
});
function makeValid() {
  return {
    title: "Test Quiz",
    subtitle: "A subtitle",
    questions: [
      { text: "Q1", qualifying: false, options: [{ text: "a", score: 0 }, { text: "b", score: MID_SCORE }, { text: "c", score: HIGH_SCORE }] },
      { text: "Q2", qualifying: false, options: [{ text: "a", score: 0 }, { text: "b", score: MID_SCORE }, { text: "c", score: HIGH_SCORE }] },
      {
        text: "Q3 qualifying",
        qualifying: true,
        options: [
          { text: "yes", score: 15, action: "continue" },
          { text: "maybe", score: 5, action: "nurture" },
          { text: "no", score: 0, action: "content" },
        ],
      },
    ],
    results: { hot: validResult("hot"), warm: validResult("warm"), cold: validResult("cold"), nurture: validResult("nurture"), content: validResult("content") },
  };
}

const validOut = validateGenerated(brief, makeValid());
check("validateGenerated accepts a well-formed quiz", !validOut.error && !!validOut.quiz);

const noQualifying = makeValid();
noQualifying.questions[2] = {
  text: "Q3 not qualifying",
  qualifying: false,
  options: [{ text: "a", score: 0 }, { text: "b", score: MID_SCORE }, { text: "c", score: HIGH_SCORE }],
};
check("validateGenerated rejects 0 qualifying questions", validateGenerated(brief, noQualifying).error?.includes("exactly 1 qualifying"));

const twoQualifying = makeValid();
twoQualifying.questions[0] = {
  text: "Q1 also qualifying",
  qualifying: true,
  options: [
    { text: "yes", score: 15, action: "continue" },
    { text: "maybe", score: 5, action: "nurture" },
    { text: "no", score: 0, action: "content" },
  ],
};
check("validateGenerated rejects 2 qualifying questions", validateGenerated(brief, twoQualifying).error?.includes("exactly 1 qualifying"));

const dupAction = makeValid();
dupAction.questions[2].options[1].action = "continue";
check("validateGenerated rejects duplicate action on qualifying question", validateGenerated(brief, dupAction).error?.includes("exactly once"));

const badScoreSet = makeValid();
badScoreSet.questions[0].options[1].score = 7; // not in {0,5,10}
check("validateGenerated rejects non-standard score on normal question", validateGenerated(brief, badScoreSet).error?.includes("must be one of"));

const dupScore = makeValid();
dupScore.questions[0].options[1].score = 0; // duplicates option[0]'s score
check("validateGenerated rejects duplicate scores in one question", validateGenerated(brief, dupScore).error?.includes("repeats a score"));

const shortResult = makeValid();
shortResult.results.hot.text = "Too short.";
check("validateGenerated rejects result text under 25 words", validateGenerated(brief, shortResult).error?.includes("25-60 words"));

const riskyResult = makeValid();
riskyResult.results.hot.text = riskyResult.results.hot.text + " This is a guaranteed result, 100% proven every time for everyone who tries it today.";
check("validateGenerated rejects a guaranteed-results claim", validateGenerated(brief, riskyResult).error?.includes("risky"));

const wrongQuestionCount = makeValid();
wrongQuestionCount.questions.push({ text: "extra", qualifying: false, options: [{ text: "a", score: 0 }, { text: "b", score: MID_SCORE }, { text: "c", score: HIGH_SCORE }] });
check("validateGenerated rejects wrong question count", validateGenerated(brief, wrongQuestionCount).error?.includes("expected exactly 3 questions"));

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
