function statusIcon(status) {
  if (status === 'PASS') return 'PASS';
  if (status === 'FINDING') return 'FINDING';
  return 'FAIL';
}

function render({ timestamp, targetUrl, summary, results }) {
  const lines = [];
  lines.push('# Stress Test Report — sales-conversion-quiz');
  lines.push('');
  lines.push(`Run: ${timestamp} | Target: ${targetUrl} | Mode: mocked Supabase submit (no real network)`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `Total: ${results.length} | Passed: ${summary.passed} | Findings (expected, documented): ${summary.findings} | Failed (unexpected): ${summary.failed}`
  );
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| # | Test | Status | Duration | Notes |');
  lines.push('|---|------|--------|----------|-------|');
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${statusIcon(r.status)} | ${(r.duration / 1000).toFixed(2)}s | ${(r.notes || '').replace(/\|/g, '\\|')} |`);
  });
  lines.push('');

  const allFindings = results.flatMap((r) => (r.findings || []).map((f) => ({ ...f, test: r.name })));
  if (allFindings.length) {
    lines.push('## Findings');
    lines.push('');
    lines.push('| # | Severity | Area | Description | Evidence | Suggested follow-up |');
    lines.push('|---|----------|------|--------------|----------|----------------------|');
    allFindings.forEach((f, i) => {
      lines.push(
        `| F${i + 1} | ${f.severity} | ${f.area} | ${f.description} | ${f.evidence} | ${f.followup} |`
      );
    });
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { render };
