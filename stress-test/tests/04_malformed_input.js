const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, answerThroughQ6, answerOption, fillAndSubmit, currentQuestionText, waitForConfirmation } = require('../lib/quizHelpers');

async function reachQ9(page) {
  await answerThroughQ6(page, { q6Index: 0 });
  await answerOption(page, 2); // Q7
  await answerOption(page, 2); // Q8
}

async function whitespaceGuardCase(browser, baseUrl, field, label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await reachQ9(page);
    if (field === 'email') await fillAndSubmit(page, 'name', 'Guard Test');

    const before = await currentQuestionText(page);
    await page.fill(`#${field}`, '   ');
    await page.locator('#quiz-container button').click();
    const after = await currentQuestionText(page);

    const advanced = before !== after;
    return {
      pass: !advanced,
      notes: `${label}: whitespace-only "${field}" ${advanced ? 'INCORRECTLY advanced' : 'correctly blocked'} (before="${before}", after="${after}")`,
    };
  } finally {
    await context.close();
  }
}

async function invalidEmailFormatCase(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const { hits } = await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await reachQ9(page);
    await fillAndSubmit(page, 'name', 'Bad Email');
    await fillAndSubmit(page, 'email', 'not-an-email');
    await waitForConfirmation(page);
    return { submitted: hits.length > 0, email: hits[0]?.email };
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const nameGuard = await whitespaceGuardCase(browser, baseUrl, 'name', 'blank-name');
  const emailGuard = await whitespaceGuardCase(browser, baseUrl, 'email', 'blank-email');
  const invalidEmail = await invalidEmailFormatCase(browser, baseUrl);

  const problems = [];
  if (!nameGuard.pass) problems.push(nameGuard.notes);
  if (!emailGuard.pass) problems.push(emailGuard.notes);

  const findings = [];
  if (invalidEmail.submitted) {
    findings.push({
      severity: 'Medium',
      area: 'Data quality',
      description: 'quiz.html has no email format validation in JS — a syntactically invalid value like "not-an-email" is submitted to Supabase as-is. The Supabase edge function does reject it server-side, so it never actually lands in the database, but the client shows a success/fallback message either way without telling the user their email looks wrong.',
      evidence: `client sent email="${invalidEmail.email}" to the submit endpoint without any client-side format check`,
      followup: 'Add a client-side email regex check (mirroring the one already in sales-quiz-submit) before allowing Q10 to advance, so users get immediate feedback instead of a silent server-side rejection.',
    });
  }

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings };
  }
  return {
    status: 'FINDING',
    notes: `${nameGuard.notes}; ${emailGuard.notes}; invalid-format email submitted=${invalidEmail.submitted}`,
    findings,
  };
};
