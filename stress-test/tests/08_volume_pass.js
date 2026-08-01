const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, completeHappyPath, waitForConfirmation, getLeads } = require('../lib/quizHelpers');

const ISOLATED_RUNS = 20;
const SHARED_RUNS = 12;

async function isolatedContextsPass(browser, baseUrl) {
  const problems = [];
  for (let i = 0; i < ISOLATED_RUNS; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const { hits } = await installMock(page, { mode: 'success' });
      await gotoQuiz(page, baseUrl);
      await completeHappyPath(page, { name: `Iso ${i}`, email: `iso-${i}@example.com` });
      await waitForConfirmation(page);
      const leads = await getLeads(page);
      if (leads.length !== 1) problems.push(`iso run ${i}: expected 1 lead in fresh context, got ${leads.length}`);
      if (hits.length !== 1) problems.push(`iso run ${i}: expected 1 submit call, got ${hits.length}`);
    } finally {
      await context.close();
    }
  }
  return problems;
}

async function sharedContextPass(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    for (let i = 0; i < SHARED_RUNS; i++) {
      await gotoQuiz(page, baseUrl); // reload; localStorage persists within this context
      await completeHappyPath(page, { name: `Shared ${i}`, email: `shared-${i}@example.com` });
      await waitForConfirmation(page);
    }
    const leads = await getLeads(page);
    return { finalCount: leads.length };
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const isoProblems = await isolatedContextsPass(browser, baseUrl);
  const shared = await sharedContextPass(browser, baseUrl);

  const problems = [...isoProblems];
  if (shared.finalCount !== SHARED_RUNS) {
    problems.push(`shared-context pass: expected ${SHARED_RUNS} accumulated leads, got ${shared.finalCount}`);
  }

  const findings = [
    {
      severity: 'Low',
      area: 'Data hygiene',
      description: 'The quiz_leads localStorage array grows without any cap or expiry — it just accumulates every completed session in that browser forever, including PII (name + email).',
      evidence: `after ${SHARED_RUNS} completions in one browser context: quiz_leads.length = ${shared.finalCount}`,
      followup: 'Cap the array size (e.g. keep last N) or drop the localStorage backup now that Supabase is the primary store, since it mainly adds unbounded PII retention risk.',
    },
  ];

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings };
  }
  return {
    status: 'FINDING',
    notes: `${ISOLATED_RUNS} isolated-context runs each produced exactly 1 lead / 1 submit call (no cross-session leakage); shared-context run accumulated ${shared.finalCount} leads with no cap`,
    findings,
  };
};
