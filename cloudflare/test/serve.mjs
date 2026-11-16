// Generates a disposable config; production wrangler.jsonc never references the fake.
import ts from 'typescript';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const config = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'),
).config;
config.main = resolve(root, 'cloudflare/test/app.ts');
config.assets.run_worker_first.push('/__test/*');
config.assets.directory = resolve(root, config.assets.directory);
config.services = [
  { binding: 'ACCOUNTS_SVC', service: 'jesklabs-accounts-e2e', entrypoint: 'IncordClient' },
];
config.vars = {
  ...config.vars,
  DEPLOYMENT_ADAPTER: 'jesklabs',
  EMAIL_TEST_SINK: '1',
  ACCOUNTS_GOOGLE: '1',
  GOOGLE_CLIENT_ID: 'fake-local-only',
  GOOGLE_CLIENT_SECRET: 'fake-local-only',
  SESSION_SECRET: 'byheart-playwright-local-only-secret-32chars',
  STATS_TOKEN: 'incord-playwright-local-stats-token-32chars',
};
config.routes = [];
delete config.triggers;
await mkdir(resolve(root, '.wrangler'), { recursive: true });
const path = resolve(root, '.wrangler/jesklabs-e2e.json');
await writeFile(path, JSON.stringify(config, null, 2));
const base = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8793');
const child = spawn(
  resolve(root, 'node_modules/.bin/wrangler'),
  [
    'dev',
    '--local',
    '--config',
    path,
    '--config',
    resolve(root, 'cloudflare/test/accounts-fake.jsonc'),
    '--infer-origin-from-routes=false',
    '--port',
    base.port,
    '--local-protocol',
    base.protocol === 'https:' ? 'https' : 'http',
    '--persist-to',
    resolve(root, '.wrangler/e2e-' + base.port),
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
