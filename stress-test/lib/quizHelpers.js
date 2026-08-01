async function gotoQuiz(page, baseUrl) {
  await page.goto(`${baseUrl}/quiz.html`, { waitUntil: 'load' });
}

async function answerOption(page, idx) {
  await page.locator('.option').nth(idx).click();
}

async function fillAndSubmit(page, field, value) {
  await page.fill(`#${field}`, value);
  await page.locator('#quiz-container button').click();
}

async function currentQuestionText(page) {
  return page.locator('.question.active h3').textContent();
}

async function getResult(page) {
  const resultVisible = await page.locator('.result.active').count();
  if (!resultVisible) return null;
  const title = await page.locator('.result.active h2').textContent();
  const paras = await page.locator('.result.active p').allTextContents();
  const ctaCount = await page.locator('.result.active .cta-button').count();
  return {
    title: title?.trim(),
    scoreText: paras[0]?.trim(),
    resultText: paras[1]?.trim(),
    hasCta: ctaCount > 0,
  };
}

async function waitForConfirmation(page, timeoutMs = 5000) {
  const banner = page.locator('#result-container > div:not(.result)');
  await banner.waitFor({ state: 'attached', timeout: timeoutMs }).catch(() => {});
  const count = await banner.count();
  return count ? (await banner.first().textContent())?.trim() : null;
}

async function getLeads(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('quiz_leads') || '[]'));
}

// quiz.html declares its state with top-level `let`, which (in a classic, non-module <script>)
// lives in the page's global lexical scope but is NOT attached to `window` — so these must be
// read as bare identifiers inside page.evaluate, not via window.currentQuestion etc.
async function getState(page) {
  return page.evaluate(() => ({
    currentQuestion,
    answers,
    totalScore,
    userAction,
  }));
}

// Drives Q1-Q5 with a fixed set of choices, then Q6 with the given index (0=committed, 1=maybe, 2=no).
async function answerThroughQ6(page, { q6Index = 0 } = {}) {
  await answerOption(page, 0); // Q1 (score-neutral)
  await answerOption(page, 2); // Q2 -> 8
  await answerOption(page, 2); // Q3 -> 10
  await answerOption(page, 2); // Q4 -> 8
  await answerOption(page, 2); // Q5 -> 10
  await answerOption(page, q6Index); // Q6
}

async function completeHappyPath(page, { name = 'Test User', email = 'test@example.com' } = {}) {
  await answerThroughQ6(page, { q6Index: 0 });
  await answerOption(page, 2); // Q7 -> 10
  await answerOption(page, 2); // Q8 -> 10
  await fillAndSubmit(page, 'name', name);
  await fillAndSubmit(page, 'email', email);
}

module.exports = {
  gotoQuiz,
  answerOption,
  fillAndSubmit,
  currentQuestionText,
  getResult,
  waitForConfirmation,
  getLeads,
  getState,
  answerThroughQ6,
  completeHappyPath,
};
