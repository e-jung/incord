import { describe, it, expect } from 'vitest';
import worker, { type Env } from '../cloudflare/worker';
import { supportUrl } from '../shared/support';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
describe('optional support configuration', () => {
  it.each([
    undefined,
    '',
    'javascript:alert(1)',
    'http://example.org',
    'https://name:password@example.org',
    'not a URL',
  ])('hides unsafe or absent configuration: %s', async (value) => {
    expect(supportUrl(value)).toBeNull();
    const response = await worker.fetch(new Request('https://app.test/api/config'), {
      DONATE_URL: value,
    } as Env);
    expect((await response.json<any>()).donateUrl).toBeNull();
  });
  it('exposes a configured public HTTPS URL without requiring account secrets', async () => {
    const response = await worker.fetch(new Request('https://app.test/api/config'), {
      DONATE_URL: 'https://example.org/support',
    } as Env);
    expect((await response.json<any>()).donateUrl).toBe('https://example.org/support');
  });
  it('preserves literal replacement tokens in a configured README URL', () => {
    const root = mkdtempSync(tmpdir() + '/incord-readme-');
    try {
      const url = "https://example.org/support?ref=$&tail=$'";
      writeFileSync(root + '/wrangler.jsonc', '{}');
      writeFileSync(
        root + '/README.md',
        'Before\n<!-- SUPPORT:START -->\n<!-- SUPPORT:END -->\nAfter',
      );
      execFileSync(process.execPath, [resolve('scripts/readme-support.mjs')], {
        cwd: root,
        env: { ...process.env, DONATE_URL: url },
      });
      const output = readFileSync(root + '/README.md', 'utf8');
      expect(output).toContain(`[Support Jesklabs](<${new URL(url).href}>)`);
      expect(output.match(/Before/g)).toHaveLength(1);
      expect(output.match(/After/g)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('omits an unset README section and renders a configured support link', () => {
    const script = `import {supportSection} from ${JSON.stringify('file://' + resolve('scripts/readme-support.mjs'))}; if(supportSection('')!=='')throw Error('unset'); if(!supportSection('https://example.org/support').includes('[Support Jesklabs]'))throw Error('configured'); let rejected=false;try{supportSection('javascript:alert(1)')}catch{rejected=true}if(!rejected)throw Error('unsafe');`;
    execFileSync(process.execPath, ['--input-type=module', '-e', script]);
  });
});
