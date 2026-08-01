const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, getState } = require('../lib/quizHelpers');

module.exports = async function run({ browser, baseUrl }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);

    const optionHandle = await page.locator('.option').first().elementHandle();
    // Two synchronous click dispatches in one evaluate call, with no re-render in between —
    // simulates a rapid double-tap / double-click on the same option.
    await optionHandle.evaluate((el) => {
      el.click();
      el.click();
    });

    const state = await getState(page);
    const duplicated = state.answers.length === 2;

    if (state.answers.length > 2 || state.currentQuestion > 2) {
      return { status: 'FAIL', notes: `unexpected state after double-click: ${JSON.stringify(state)}`, findings: [] };
    }

    if (duplicated) {
      return {
        status: 'FINDING',
        notes: `double-click pushed 2 answers and advanced currentQuestion by 2 (answers=${state.answers.length}, currentQuestion=${state.currentQuestion})`,
        findings: [
          {
            severity: 'Low',
            area: 'Logic',
            description: 'handleOption() has no debounce/guard, so a rapid double-click (or scripted double-tap on mobile) on the same option registers two answers and can double-count score for that question.',
            evidence: `after one physical double-click on Q1's first option: answers=${JSON.stringify(state.answers)}, currentQuestion=${state.currentQuestion}`,
            followup: 'Disable/hide options immediately on first click, or guard handleOption() against being called twice for the same question.',
          },
        ],
      };
    }

    return { status: 'PASS', notes: `double-click did not duplicate the answer (answers=${state.answers.length})`, findings: [] };
  } finally {
    await context.close();
  }
};
