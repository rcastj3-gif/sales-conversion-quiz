const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, answerThroughQ6, getResult, getLeads, currentQuestionText } = require('../lib/quizHelpers');

async function runBranch(browser, baseUrl, { q6Index, expectedTitleFragment, label }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleTexts = [];
  page.on('console', (msg) => consoleTexts.push(msg.text()));
  try {
    const { hits } = await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await answerThroughQ6(page, { q6Index });

    // storeLead() is fire-and-forget from showResult(); give it a beat to run and hit its
    // "no email captured" early return before we inspect state.
    await page.waitForTimeout(300);

    const result = await getResult(page);
    const leads = await getLeads(page);
    const problems = [];
    if (!result || !result.title.includes(expectedTitleFragment)) {
      problems.push(`${label}: expected title containing "${expectedTitleFragment}", got ${JSON.stringify(result)}`);
    }
    const reachedQ7 = /Q7:/.test((await currentQuestionText(page).catch(() => '')) || '');
    if (reachedQ7) problems.push(`${label}: quiz advanced to Q7 despite early-exit action`);

    const noEmailLogged = consoleTexts.some((t) => t.includes('No email captured'));

    return {
      problems,
      submitCalls: hits.length,
      leadsStored: leads.length,
      noEmailLogged,
    };
  } finally {
    await context.close();
  }
};

module.exports = async function run({ browser, baseUrl }) {
  const nurture = await runBranch(browser, baseUrl, { q6Index: 1, expectedTitleFragment: 'Stay Connected', label: 'nurture' });
  const content = await runBranch(browser, baseUrl, { q6Index: 2, expectedTitleFragment: 'Free Resources', label: 'content' });

  const problems = [...nurture.problems, ...content.problems];
  const findings = [];

  for (const [label, r] of [['nurture', nurture], ['content', content]]) {
    if (r.submitCalls === 0 && r.leadsStored === 0) {
      findings.push({
        severity: 'Low',
        area: 'Data quality',
        description: `A "${label}" early-exit lead (Q6 answered before reaching name/email) is never captured anywhere — not sent to Supabase, not stored locally — because storeLead() requires an email that was never collected.`,
        evidence: `submit calls=${r.submitCalls}, leads stored=${r.leadsStored}, "No email captured" logged=${r.noEmailLogged}`,
        followup: 'Decide if this is intentional (only committed leads matter) or if partial/early-exit leads should also be captured (e.g. by email/first-name earlier in the flow).',
      });
    }
  }

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings };
  }
  return {
    status: findings.length ? 'FINDING' : 'PASS',
    notes: `nurture and content branches show correct result copy and stop before Q7; ${findings.length} finding(s) about early-exit lead capture`,
    findings,
  };
};
