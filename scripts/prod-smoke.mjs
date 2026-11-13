#!/usr/bin/env node
// Run manually: SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs
// Uses real APIs and disposable browser profiles. Never mocks or seeds app state.
import { chromium, devices, expect as baseExpect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const run = promisify(execFile);

if (process.argv.includes('--help')) {
  console.log('Usage: SMOKE_URL=http://localhost:8793 node scripts/prod-smoke.mjs\nDefault: https://incord.jesklabs.com\nSigns in with jung.ai.assistant@gmail.com and deletes the smoke account in finally. Requires configured email and push keys. SMOKE_CODE_CMD overrides the Gmail code reader (print a subject or six-digit code). Reader credentials come only from the selected GOG vars in /home/ubuntu/.openclaw/.env. Two codes/run; rate limits may require a 15-minute wait. Legacy host checks run on production; override with SMOKE_LEGACY_URL.');
  process.exit(0);
}

// Match playwright.config.ts: do not send local or private smoke traffic via a proxy.
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[name];
const target = new URL(process.env.SMOKE_URL || 'https://incord.jesklabs.com');
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
  throw new Error('SMOKE_URL must be an HTTP(S) URL without credentials, query, or fragment');
}
const origin = target.origin;
const expect = baseExpect.configure({ timeout: 15_000 });
const results = [];
const contexts = [];
const diagnostics = [];
const secrets = new Set();
let browser, creationAttempted = false, userId, learnedItem;
const started = Date.now();

function safe(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  // No stack, account export, sign-in-code artifacts are written.
  return message.slice(0, 1800);
}
async function check(name, action) {
  try {
    await action();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: safe(error) });
    throw error;
  }
}
async function api(context, path, method = 'GET') {
  const response = await context.request.fetch(origin + '/api' + path, {
    method, headers: { Origin: origin }, timeout: 15_000,
  });
  if (!response.ok()) throw new Error(`${method} /api${path}: HTTP ${response.status()}`);
  return response.json();
}
async function device(label) {
  const context = await browser.newContext({
    ...devices['iPhone 13'], // iPhone 15 CSS viewport.
    viewport: { width: 393, height: 852 },
    colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'allow',
    // Local Wrangler accepts this edge-owned header; isolate concurrent QA callers.
    ...(target.hostname==='localhost'?{extraHTTPHeaders:{'CF-Connecting-IP':'smoke-'+crypto.randomUUID()}}:{}),
  });
  contexts.push(context); // Retain immediately so finally can clean up partial flows.
  // Opt smoke browsers out of anonymous usage counts so test runs never pollute /stats.
  await context.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true }); } catch {} });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  await context.exposeBinding('__smokeCspViolation', (_source, value) => {
    diagnostics.push(`${label}: CSP ${value}`);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      // Directive only: blocked URLs can contain private data.
      void window.__smokeCspViolation(event.effectiveDirective);
    });
  });
  context.on('page', page => {
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.push(`${label}: console ${message.text()}`);
    });
    page.on('pageerror', error => diagnostics.push(`${label}: uncaught ${error.message}`));
  });
  const page = await context.newPage();
  const response = await page.goto(target.href);
  expect(response?.ok(), `${label}: app returned HTTP success`).toBe(true);
  expect(new URL(page.url()).origin, 'Smoke must stay on the requested origin').toBe(origin);
  const policy = response.headers()['content-security-policy'];
  expect(policy, 'An enforcing CSP header is present').toContain("default-src 'self'");
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  return { context, page };
}
async function tab(page, name) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}
async function account(page) {
  await tab(page, 'Today');
  await page.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
}
const smokeEmail = 'jung.ai.assistant@gmail.com';
const seenCodes = new Set();
const defaultCodeCommand = "gog --account jung.ai.assistant@gmail.com --no-input gmail search 'from:signin@incord.jesklabs.com newer_than:10m' --max 1";
async function readCodes() {
  // Do not mutate the parent environment or expose command output/errors: they
  // may contain mailbox content, codes, or credentials from a custom reader.
  const env = { ...process.env };
  const names = ['GOG_HOME', 'GOG_KEYRING_BACKEND', 'GOG_KEYRING_PASSWORD'];
  for (const name of names) delete env[name];
  try {
    const configured = parseEnv(await readFile('/home/ubuntu/.openclaw/.env', 'utf8'));
    for (const name of names) if (configured[name] !== undefined) env[name] = configured[name];
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to load smoke code-reader environment');
  }
  env.PATH = '/home/ubuntu/.local/bin:' + (env.PATH || '');
  let stdout;
  try {
    ({ stdout } = await run('/bin/sh', ['-c', process.env.SMOKE_CODE_CMD || defaultCodeCommand], {
      env, timeout: 15_000, maxBuffer: 128 * 1024,
    }));
  } catch { throw new Error('Smoke code reader failed (output withheld)'); }
  const codes = [...stdout.matchAll(/Your Incord code:\s*(\d{6})\b/gi)].map(match => match[1]);
  if (/^\d{6}$/.test(stdout.trim())) codes.push(stdout.trim());
  for (const code of codes) secrets.add(code);
  return codes;
}
async function emailSignin(page, beforeVerify = () => {}) {
  // Snapshot the latest subject BEFORE requesting a code so an older delivery
  // can never satisfy a new flow, including the second isolated browser.
  for (const code of await readCodes()) seenCodes.add(code);
  await page.getByLabel('Email address', { exact: true }).fill(smokeEmail);
  for (let attempt = 0; ; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/email/start' && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Email me a code', exact: true }).click(),
    ]);
    if (response.status() !== 429) {
      expect(response.ok(), 'Email code request succeeded').toBe(true);
      break;
    }
    if (attempt >= 1) throw new Error('Email code send limit still active after waiting; no further sends attempted');
    console.log('INFO Email send limit reached; waiting 15 minutes before one retry.');
    await delay(15 * 60_000 + 1_000);
    for (const code of await readCodes()) seenCodes.add(code);
  }
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const code = (await readCodes()).find(code => !seenCodes.has(code));
    if (code) {
      seenCodes.add(code);
      beforeVerify();
      await page.getByLabel('Six-digit code').fill(code);
      await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
      return;
    }
    await delay(3_000);
  }
  throw new Error('No fresh sign-in code arrived within two minutes; no resend attempted');
}
// Read-only evidence that the actual UI persisted its attempts; never seed IDB.
async function state(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('byheart', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('state').objectStore('state').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}
function john(data) {
  return data?.items?.find(item => item.title === 'John 3:16' && !item.deleted);
}
function learned(data) {
  const item = john(data);
  return !!(item?.learned && item.step === 4 && item.learnedAt && item.card && Date.parse(item.due) > Date.now());
}
function syncResponse(page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/api/sync' && response.request().method() === 'POST');
}

console.log(`Incord smoke: ${origin} (Chromium, iPhone 15 393×852)`);
try {
  browser = await chromium.launch({ headless: true });
  let first, second;
  const localLegacy = ['localhost','127.0.0.1'].includes(target.hostname) && !process.env.SMOKE_LEGACY_URL;
  const canonicalOrigin = localLegacy ? 'https://incord.jesklabs.com' : origin;
  const legacyOrigin = process.env.SMOKE_LEGACY_URL || (localLegacy ? origin : origin === 'https://incord.jesklabs.com' ? 'https://byheart.jesklabs.com' : '');
  if (legacyOrigin) await check('Legacy origin redirects paths and retires APIs', async () => {
    const legacy = new URL(legacyOrigin);
    expect(['http:', 'https:'].includes(legacy.protocol) && !legacy.username && !legacy.password && !legacy.search && !legacy.hash, 'Valid legacy origin').toBe(true);
    const context = await browser.newContext({ extraHTTPHeaders: localLegacy ? { Host: 'byheart.jesklabs.com' } : {} });
    contexts.push(context);
    const redirect = await context.request.get(legacy.origin + '/account?migration=smoke', { maxRedirects: 0 });
    expect(redirect.status()).toBe(301);
    expect(redirect.headers().location).toBe(canonicalOrigin + '/account?migration=smoke');
    const retired = await context.request.get(legacy.origin + '/api/config', { maxRedirects: 0 });
    expect(retired.status()).toBe(410);
    expect(retired.headers()['content-type']).toContain('application/json');
    expect(JSON.stringify(await retired.json())).toMatch(/update|incord/i);
    const sw = await context.request.get(legacy.origin + '/sw.js', { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type']).toMatch(/javascript/);
    expect(await sw.text()).toContain('unregister');
    await context.close();
    contexts.splice(contexts.indexOf(context), 1);
  });
  await check('App loads signed out with enforcing CSP', async () => {
    first = await device('first device');
    expect(await api(first.context, '/me')).toEqual({ user: null });
  });
  await check('Gospel starter added through the UI', async () => {
    const { page } = first;
    await tab(page, 'Library');
    await page.locator('.covers').getByRole('button').filter({ has: page.locator('b', { hasText: 'The Gospel in 10 verses' }) }).click();
    const preview = page.getByRole('dialog', { name: 'The Gospel in 10 verses', exact: true });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Add to my library', exact: true }).click();
    await expect.poll(async () => (await state(page))?.items?.filter(item => !item.deleted).length).toBe(10);
    await expect(page.getByRole('button', { name: /^John 3:16\b/ })).toBeVisible();
    await page.getByRole('button', { name: /^John 3:16\b/ }).click();
    await expect(page.getByRole('heading', { name: 'John 3:16', exact: true })).toBeVisible();
  });
  for (let step = 1; step <= 4; step++) {
    await check(`John 3:16 ladder step ${step}/4`, async () => {
      const { page } = first;
      await expect(page.getByText(new RegExp(`^Step ${step} of 4`))).toBeVisible();
      const words = await page.locator('[data-word]').allTextContents();
      expect(words.length).toBeGreaterThan(20);
      const hidden = await page.locator('[data-hidden="true"]').count();
      if (step === 1) expect(hidden).toBe(0);
      else if (step === 4) expect(hidden).toBe(words.length);
      else expect(hidden).toBeGreaterThan(0);
      for (const word of words) {
        const key = Array.from(word.replace(/^[^\p{L}\p{N}]+/u, ''))[0].toLowerCase();
        // Exercise the mobile keyboard too; no shortcuts or direct state updates.
        if (step === 2) await page.getByLabel('Practice keyboard').getByRole('button', { name: key.toUpperCase(), exact: true }).click();
        else await page.keyboard.press(key);
      }
      const result = page.getByRole('dialog', { name: step === 4 ? 'Learned' : `Step ${step} passed`, exact: true });
      await expect(result).toBeVisible();
      if (step > 1 && step < 4) await expect(result).toContainText(`${hidden} of ${hidden} from memory · 0 slips`);
      await result.getByRole('button', { name: step === 4 ? 'Finish' : 'Continue', exact: true }).click();
    });
  }
  await check('Learned screen and four saved attempts', async () => {
    await expect(first.page.getByRole('heading', { name: 'Learned', exact: true })).toBeVisible();
    await expect(first.page.locator('.keepsake')).toContainText('John 3:16');
    await expect.poll(async () => learned(await state(first.page))).toBe(true);
    const saved = await state(first.page);
    learnedItem = john(saved);
    const attempts = saved.events.filter(event => event.itemId === learnedItem.id);
    expect(attempts.map(event => event.step)).toEqual([1, 2, 3, 4]);
    expect(attempts.every(event => event.slips === 0)).toBe(true);
    await first.page.getByRole('button', { name: 'Back to Today', exact: true }).click();
  });
  await check('Email-code signup through UI and /api/me identity', async () => {
    const { page, context } = first;
    await account(page);
    creationAttempted = true;
    await emailSignin(page);
    const me = await api(context, '/me');
    expect(typeof me.user?.id).toBe('string');
    expect(me.user?.hasEmail).toBe(true);
    userId = me.user.id;
  });
  await check('Explicit Add ownership choice uploads learned item and history', async () => {
    const { page, context } = first;
    const merge = page.getByRole('dialog', { name: 'Add the 10 items on this device to your account?', exact: true });
    await expect(merge).toBeVisible();
    expect((await api(context, '/export')).items).toHaveLength(0);
    const [response] = await Promise.all([
      syncResponse(page),
      merge.getByRole('button', { name: 'Add', exact: true }).click(),
    ]);
    expect(response.ok(), 'UI sync succeeded').toBe(true);
    expect(learned(await response.json())).toBe(true);
    await expect(page.getByText('Signed in.', { exact: true })).toBeVisible();
    await expect.poll(async () => learned(await api(context, '/export')), { timeout: 30_000 }).toBe(true);
    const exported = await api(context, '/export');
    expect(exported.items.filter(item => !item.deleted)).toHaveLength(10);
    expect(exported.events.filter(event => event.itemId === learnedItem.id)).toHaveLength(4);
    await expect.poll(async () => (await state(page)).queue.length).toBe(0);
  });
  await check('Second isolated device signs in with a fresh email code and downloads learned item', async () => {
    second = await device('second device');
    const { page, context } = second;
    expect(await api(context, '/me')).toEqual({ user: null });
    expect(john(await state(page))).toBeUndefined();
    await account(page);
    let responsePromise;
    await emailSignin(page, () => {
      // Arm only when a code arrives: the send-limit cooldown can last 15 min.
      responsePromise = syncResponse(page);
      void responsePromise.catch(() => {}); // emailSignin can fail before sync.
    });
    const response = await responsePromise;
    expect(response.ok(), 'Email sign-in triggers real sync').toBe(true);
    expect((await api(context, '/me')).user?.id).toBe(userId);
    await expect.poll(async () => learned(await state(page)), { timeout: 30_000 }).toBe(true);
    const recovered = await state(page);
    expect(john(recovered).id).toBe(learnedItem.id);
    expect(recovered.events.filter(event => event.itemId === learnedItem.id)).toHaveLength(4);
    await tab(page, 'Library');
    await page.getByRole('button', { name: /^The Gospel in 10 verses.*1 of 10 learned/ }).click();
    await expect(page.getByRole('button', { name: /^John 3:16\b/ })).toContainText('Review');
  });
  await check('Push configuration enabled and service workers activated on both devices', async () => {
    expect((await api(first.context, '/config')).push).toBe(true);
    for (const { page } of [first, second]) {
      await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        return registration?.active?.state === 'activated' && new URL(registration.active.scriptURL).pathname === '/sw.js';
      }), { timeout: 30_000 }).toBe(true);
    }
  });
  await check('UI account deletion signs out both sessions (/api/me user:null)', async () => {
    await account(second.page);
    await second.page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await second.page.getByRole('button', { name: 'Yes, delete account', exact: true }).click();
    await expect(second.page.getByRole('status')).toHaveText('Account deleted. Local practice is still on this device.');
    for (const context of contexts) expect(await api(context, '/me')).toEqual({ user: null });
  });
} catch (error) {
  if (!results.some(result => !result.ok)) results.push({ name: 'Smoke setup', ok: false, error: safe(error) });
} finally {
  // Independent of UI state: a failure after email sign-in must not leave an account.
  // APIRequestContext shares each isolated profile's cookies and sends the required Origin.
  await check('Cleanup: no smoke account remains', async () => {
    const failures = [];
    if (creationAttempted) {
      for (const context of contexts) {
        try {
          const me = await api(context, '/me');
          if (me.user) {
            if (userId && me.user.id !== userId) throw new Error('Unexpected account identity during cleanup');
            await api(context, '/account', 'DELETE');
          }
        } catch (error) { failures.push(safe(error)); }
      }
      // Check every session, including the one whose cookie deletion did not clear.
      for (const context of contexts) {
        try { expect(await api(context, '/me')).toEqual({ user: null }); }
        catch (error) { failures.push(safe(error)); }
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
  }).catch(() => {}); // Recorded by check; still close resources and print summary.
  // Closing profiles stops in-flight app requests and SWs; no storageState/trace persists secrets.
  for (const context of contexts) {
    await context.close().catch(error => results.push({ name: 'Close browser profile', ok: false, error: safe(error) }));
  }
  if (browser) await browser.close().catch(error => results.push({ name: 'Close browser', ok: false, error: safe(error) }));
  const errors = [...new Set(diagnostics.map(safe))];
  results.push({ name: 'No console errors, uncaught errors, or CSP violations (both devices)', ok: errors.length === 0, error: errors.join('\n') });
  const failed = results.filter(result => !result.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — ${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const result of failed) console.error(`FAIL ${result.name}\n${result.error}`);
  process.exitCode = failed.length ? 1 : 0;
}
