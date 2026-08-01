const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, answerOption, fillAndSubmit, waitForConfirmation, getResult } = require('../lib/quizHelpers');
const { computeAchievableCombos } = require('../lib/scoring');

function classify(score) {
  if (score >= 25) return 'hot';
  if (score >= 15) return 'warm';
  return 'cold';
}

async function driveToScore(browser, baseUrl, combo, label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await answerOption(page, 0); // Q1
    await answerOption(page, combo.indices.q2);
    await answerOption(page, combo.indices.q3);
    await answerOption(page, combo.indices.q4);
    await answerOption(page, combo.indices.q5);
    await answerOption(page, 0); // Q6 committed
    await answerOption(page, combo.indices.q7);
    await answerOption(page, combo.indices.q8);
    await fillAndSubmit(page, 'name', `Boundary ${label}`);
    await fillAndSubmit(page, 'email', `boundary-${label}@example.com`);
    await waitForConfirmation(page);
    const result = await getResult(page);
    return result;
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const combos = computeAchievableCombos();
  const scores = combos.map((c) => c.score);
  const minScore = scores[0];
  const coldReachable = scores.some((s) => s < 15);
  const largestBelow25 = Math.max(...scores.filter((s) => s < 25));
  const smallestAtOrAbove25 = Math.min(...scores.filter((s) => s >= 25));

  const targets = [
    { label: 'min', score: minScore },
    { label: 'largest-below-25', score: largestBelow25 },
    { label: 'smallest-at-or-above-25', score: smallestAtOrAbove25 },
  ];

  const problems = [];
  const observed = [];
  for (const target of targets) {
    const combo = combos.find((c) => c.score === target.score);
    const result = await driveToScore(browser, baseUrl, combo, target.label);
    const actualScore = Number((result?.scoreText || '').match(/\d+/)?.[0]);
    const expectedBucket = classify(target.score);
    const actualBucket = /Hot Lead/.test(result?.title || '')
      ? 'hot'
      : /Warm Lead/.test(result?.title || '')
      ? 'warm'
      : /Content Recommendation/.test(result?.title || '')
      ? 'cold'
      : 'unknown';
    observed.push(`${target.label}=${target.score}(${actualBucket})`);
    if (actualScore !== target.score) problems.push(`${target.label}: expected displayed score ${target.score}, got ${actualScore}`);
    if (actualBucket !== expectedBucket) problems.push(`${target.label}: expected ${expectedBucket} bucket, got ${actualBucket}`);
  }

  const findings = [];
  if (!coldReachable) {
    findings.push({
      severity: 'Info',
      area: 'Logic',
      description: 'The "cold" result bucket (score < 15) appears unreachable via the real UI on the "continue" path — every full completion scores 15 or higher.',
      evidence: `min achievable score on continue path = ${minScore}; achievable scores near thresholds: ${JSON.stringify(scores.slice(0, 6))}...`,
      followup: 'Confirm this is intended (cold is only reachable via the nurture/content early-exit branches) or adjust the scoring table/thresholds.',
    });
  }
  if (smallestAtOrAbove25 - largestBelow25 > 1) {
    findings.push({
      severity: 'Info',
      area: 'Logic',
      description: `The hot/warm boundary "jumps" — no achievable score equals exactly ${largestBelow25 + 1}..${smallestAtOrAbove25 - 1}, so the ">= 25" hot threshold behaves like ">= ${smallestAtOrAbove25}" in practice.`,
      evidence: `largest achievable score below 25 = ${largestBelow25}; smallest achievable score at/above 25 = ${smallestAtOrAbove25}`,
      followup: 'Not a bug, but worth knowing the real cutoff is 26 in practice, not 25, if that matters for messaging.',
    });
  }

  if (problems.length) {
    return { status: 'FAIL', notes: problems.join('; '), findings };
  }
  return {
    status: findings.length ? 'FINDING' : 'PASS',
    notes: `observed ${observed.join(', ')}; classification matched expected thresholds in all cases`,
    findings,
  };
};
