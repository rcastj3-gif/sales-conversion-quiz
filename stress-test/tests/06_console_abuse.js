const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, getState, getLeads } = require('../lib/quizHelpers');

async function outOfRangeCase(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    const before = await getState(page);

    let threw = null;
    try {
      await page.evaluate(() => handleOption(999));
    } catch (err) {
      threw = err.message;
    }

    const after = await getState(page);
    return { threw, stateUnchanged: before.currentQuestion === after.currentQuestion && before.answers.length === after.answers.length };
  } finally {
    await context.close();
  }
}

async function concurrentStoreLeadCase(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const { hits } = await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);

    await page.evaluate(async () => {
      answers.push({ question: 9, answer: 'Race Condition', field: 'name' });
      answers.push({ question: 10, answer: 'race@example.com', field: 'email' });
      totalScore = 30;
      await Promise.all([
        storeLead('hot', 'Hot Lead', 'race test'),
        storeLead('hot', 'Hot Lead', 'race test'),
      ]);
    });

    const leads = await getLeads(page);
    return { submitCalls: hits.length, leadsStored: leads.length };
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const outOfRange = await outOfRangeCase(browser, baseUrl);
  const race = await concurrentStoreLeadCase(browser, baseUrl);

  const problems = [];
  if (!outOfRange.threw) problems.push('handleOption(999) did not throw — expected a TypeError from reading an undefined option');
  if (!outOfRange.stateUnchanged) problems.push('handleOption(999) mutated quiz state despite the option being undefined');

  const findings = [];
  findings.push({
    severity: 'Low',
    area: 'Robustness',
    description: 'handleOption() does not validate the index it receives, so calling it out of range (possible from devtools, or from a malformed onclick if the DOM is tampered with) throws an uncaught TypeError instead of failing gracefully.',
    evidence: `handleOption(999) threw: ${outOfRange.threw || '(did not throw — see FAIL above)'}`,
    followup: 'Add a bounds check at the top of handleOption() and no-op or log instead of throwing.',
  });

  findings.push({
    severity: race.submitCalls > 1 || race.leadsStored > 1 ? 'Medium' : 'Low',
    area: 'Concurrency',
    description: 'storeLead()\'s read-modify-write on localStorage (JSON.parse -> push -> setItem) is not atomic, so two concurrent calls (e.g. a double showResult() invocation) can race.',
    evidence: `two concurrent storeLead() calls produced ${race.submitCalls} Supabase submit call(s) and ${race.leadsStored} localStorage lead row(s)`,
    followup: race.submitCalls > 1
      ? 'Guard storeLead() with an in-flight flag so it only ever runs once per completed quiz.'
      : 'Confirmed non-atomic localStorage write; low practical impact since showResult() is normally only called once per session, but worth a guard if that assumption changes.',
  });

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings };
  }
  return {
    status: 'FINDING',
    notes: `out-of-range handleOption() throws as expected and leaves state untouched; concurrent storeLead() produced ${race.submitCalls} submit call(s) / ${race.leadsStored} lead row(s)`,
    findings,
  };
};
