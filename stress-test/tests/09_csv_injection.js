const fs = require('fs');
const { installMock } = require('../lib/mockSupabaseSubmit');
const { gotoQuiz, completeHappyPath, waitForConfirmation } = require('../lib/quizHelpers');

async function exportAndRead(browser, baseUrl, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await installMock(page, { mode: 'success' });
    await gotoQuiz(page, baseUrl);
    await completeHappyPath(page, { name, email: 'csv-test@example.com' });
    await waitForConfirmation(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => exportLeads()),
    ]);
    const filePath = await download.path();
    const csv = fs.readFileSync(filePath, 'utf8');
    return csv;
  } finally {
    await context.close();
  }
}

module.exports = async function run({ browser, baseUrl }) {
  const formulaName = "=cmd|'/c calc'!A1";
  const commaQuoteName = 'O\'Brien, "Bob"';

  const formulaCsv = await exportAndRead(browser, baseUrl, formulaName);
  const commaQuoteCsv = await exportAndRead(browser, baseUrl, commaQuoteName);

  const formulaLine = formulaCsv.split('\n').find((l) => l.startsWith('=cmd'));
  const formulaUnescaped = Boolean(formulaLine);

  const commaQuoteLine = commaQuoteCsv.split('\n').find((l) => l.includes("O'Brien"));
  const columnCount = commaQuoteLine ? commaQuoteLine.split(',').length : 0;
  const columnsCorrupted = columnCount > 5; // Name,Email,Result,Score,Date = 5 expected fields

  const findings = [];
  if (formulaUnescaped) {
    findings.push({
      severity: 'Medium',
      area: 'Security',
      description: 'exportLeads() builds CSV rows with plain string concatenation and no escaping, so a lead name starting with = (or +/-/@) is written verbatim — a classic CSV formula-injection risk if the exported file is opened in Excel/Sheets.',
      evidence: `exported CSV contains the unescaped line: ${formulaLine}`,
      followup: "Quote every field per RFC 4180 and prefix a leading =/+/-/@ with a ' or a space before writing the CSV.",
    });
  }
  if (columnsCorrupted) {
    findings.push({
      severity: 'Medium',
      area: 'Data integrity',
      description: 'A lead name containing a comma or quote (e.g. from a legitimate name like "O\'Brien, Bob") breaks the CSV into extra columns on open, since fields are never quoted.',
      evidence: `exported line for a comma/quote-containing name split into ${columnCount} columns instead of the expected 5: ${commaQuoteLine}`,
      followup: 'Same fix as above — RFC 4180 quoting handles both issues.',
    });
  }

  if (!formulaLine || !commaQuoteLine) {
    return { status: 'FAIL', notes: 'could not locate expected lead rows in exported CSV — export may have failed', findings: [] };
  }

  return {
    status: findings.length ? 'FINDING' : 'PASS',
    notes: `formula-injection risk=${formulaUnescaped}, column corruption=${columnsCorrupted}`,
    findings,
  };
};
