const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, completeHappyPath, waitForConfirmation, getLeads } = require('../lib/quizHelpers');

async function runMode(browser, baseUrl, mode) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode });
    await gotoQuiz(page, baseUrl);
    await completeHappyPath(page, { name: 'Network Fail', email: `netfail-${mode}@example.com` });
    const confirmation = await waitForConfirmation(page);
    const leads = await getLeads(page);
    return { mode, confirmation, lead: leads[0] };
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const abort = await runMode(browser, baseUrl, 'abort');
  const fail500 = await runMode(browser, baseUrl, 'fail-500');

  const problems = [];
  const expectedText = 'Result saved. We will follow up shortly.';
  for (const r of [abort, fail500]) {
    if (!r.confirmation || !r.confirmation.includes(expectedText)) {
      problems.push(`${r.mode}: expected fallback confirmation text, got "${r.confirmation}"`);
    }
    if (!r.lead || r.lead.synced !== false) {
      problems.push(`${r.mode}: expected localStorage lead with synced:false, got ${JSON.stringify(r.lead)}`);
    }
  }

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings: [] };
  }
  return {
    status: 'PASS',
    notes: `both abort and fail-500 modes still save locally (synced:false) and show the correct fallback message`,
    findings: [],
  };
};
