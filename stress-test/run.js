const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const staticServer = require('./lib/staticServer');
const { runAll } = require('./lib/testRunner');
const report = require('./lib/report');

const REPO_ROOT = path.join(__dirname, '..');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

const TEST_FILES = [
  '01_happy_path',
  '02_early_exit_branches',
  '03_score_boundaries',
  '04_malformed_input',
  '05_rapid_double_click',
  '06_console_abuse',
  '07_network_failure',
  '08_volume_pass',
  '09_csv_injection',
];

async function main() {
  const server = await staticServer.start(REPO_ROOT);
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });

  const tests = TEST_FILES.map((name) => ({ name, mod: require(`./tests/${name}`) }));

  let summary;
  try {
    summary = await runAll(tests, { browser, baseUrl: server.url });
  } finally {
    await browser.close();
    await server.close();
  }

  const timestamp = new Date().toISOString();
  const md = report.render({
    timestamp,
    targetUrl: `${server.url}/quiz.html`,
    summary,
    results: summary.results,
  });

  console.log('');
  console.log(md);

  const reportDir = path.join(__dirname, 'report');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${timestamp.replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(reportPath, md);
  console.log(`\nReport written to ${reportPath}`);

  // FAIL results are unexpected regressions/harness breakage; FINDING results are known,
  // intentionally-demonstrated issues and should not turn a clean run red.
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('Stress test run crashed:', err);
  process.exitCode = 1;
});
