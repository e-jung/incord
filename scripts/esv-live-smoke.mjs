/** Opt-in: ESV_LIVE_SMOKE=1 WORKER_URL=https://incord.jesklabs.com node scripts/esv-live-smoke.mjs
 * Exactly one real API request via the Worker; no credentials, reference text or quotations are logged. */
if (process.env.ESV_LIVE_SMOKE !== '1') {
  console.log('Skipped: set ESV_LIVE_SMOKE=1 and WORKER_URL to opt in (one request).');
} else {
  const origin = new URL(process.env.WORKER_URL || 'http://localhost:8793');
  const response = await fetch(new URL('/api/esv?q=John%203%3A16', origin), {
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw Error(`ESV proxy smoke failed: HTTP ${response.status}`);
  if (!response.headers.get('cache-control')?.includes('no-store'))
    throw Error('ESV response must not be cached.');
  if (!response.headers.get('content-type')?.includes('text/plain'))
    throw Error('ESV response must be plain text.');
  const text = await response.text();
  if (!text.includes('For God so loved the world')) throw Error('Unexpected ESV response.');
  console.log('ESV live smoke passed (one request; quotation omitted).');
}
