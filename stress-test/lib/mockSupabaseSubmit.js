const SUBMIT_URL_PATTERN = 'https://qrudzrbueqcjprgyfvsq.supabase.co/functions/v1/sales-quiz-submit';

// Intercepts the quiz's Supabase submit call and NEVER calls route.continue() —
// that's what guarantees zero real network egress during the stress test.
async function installMock(page, { mode = 'success' } = {}) {
  const hits = [];

  await page.route(SUBMIT_URL_PATTERN, async (route) => {
    const request = route.request();
    let body = null;
    try {
      body = JSON.parse(request.postData() || '{}');
    } catch {
      body = { __unparsable: request.postData() };
    }
    hits.push(body);

    if (mode === 'abort') {
      await route.abort('failed');
      return;
    }
    if (mode === 'fail-500') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'mock failure' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, submission_id: 'mock-id', share_ref: 'qz_mock0000000000' }),
    });
  });

  return { hits };
}

module.exports = { installMock, SUBMIT_URL_PATTERN };
