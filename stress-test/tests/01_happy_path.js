const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, completeHappyPath, waitForConfirmation, getResult, getLeads } = require('../lib/quizHelpers');

module.exports = async function run({ browser, baseUrl }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const { hits } = await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await completeHappyPath(page, { name: 'Happy Path', email: 'happy@example.com' });
    await waitForConfirmation(page);

    const result = await getResult(page);
    const leads = await getLeads(page);

    const problems = [];
    if (!result || !/Hot Lead/.test(result.title)) problems.push(`expected hot-lead title, got ${JSON.stringify(result)}`);
    if (!result?.hasCta) problems.push('expected CTA button on hot result');
    if (hits.length !== 1) problems.push(`expected exactly 1 Supabase submit call, got ${hits.length}`);
    if (hits[0]?.email !== 'happy@example.com') problems.push(`unexpected submit payload email: ${hits[0]?.email}`);
    if (hits[0]?.primary_result !== 'hot') problems.push(`unexpected primary_result: ${hits[0]?.primary_result}`);
    if (leads.length !== 1) problems.push(`expected 1 localStorage lead, got ${leads.length}`);
    if (leads[0]?.synced !== true) problems.push(`expected synced:true, got ${leads[0]?.synced}`);

    return problems.length
      ? { status: 'FAIL', notes: problems.join('; '), findings: [] }
      : { status: 'PASS', notes: `hot result, 1 submit call, 1 lead stored, synced=true`, findings: [] };
  } finally {
    await context.close();
  }
};
