// Each test module exports async run(ctx) -> { status: 'PASS'|'FAIL'|'FINDING', notes, findings? }
// PASS: behaves as expected (including a regression guard holding).
// FINDING: harness worked correctly and confirmed a known, pre-existing issue — not a harness failure.
// FAIL: something broke that shouldn't have (a real regression or a broken test itself).
async function runAll(tests, ctx) {
  const results = [];
  for (const { name, mod } of tests) {
    const start = Date.now();
    try {
      const outcome = await mod(ctx);
      results.push({ name, ...outcome, duration: Date.now() - start });
    } catch (err) {
      results.push({
        name,
        status: 'FAIL',
        notes: `threw unexpectedly: ${err && err.message ? err.message : err}`,
        findings: [],
        duration: Date.now() - start,
      });
    }
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const findings = results.filter((r) => r.status === 'FINDING').length;
  return { results, passed, failed, findings };
}

module.exports = { runAll };
