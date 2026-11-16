// Generate beside the base: Wrangler resolves main/assets/build paths relative to it.
import ts from 'typescript';
import { jesklabs } from '../cloudflare/adapters/jesklabs.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const base = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
);
if (base.error) throw new Error('Invalid base Wrangler config');
const config = {
  ...base.config,
  workers_dev: false,
  services: [
    {
      binding: 'ACCOUNTS_SVC',
      service: jesklabs.accountsService,
      entrypoint: jesklabs.accountsEntrypoint,
    },
  ],
  routes: [{ pattern: new URL(jesklabs.appOrigin).hostname, custom_domain: true }],
  vars: {
    ...base.config.vars,
    ACCOUNTS_GOOGLE: '1',
    DONATE_URL: jesklabs.donateUrl,
    APP_ORIGIN: jesklabs.appOrigin,
  },
};
writeFileSync(
  new URL('../wrangler.production.generated.json', import.meta.url),
  JSON.stringify(config, null, 2) + '\n',
);
console.log('Generated wrangler.production.generated.json (Jesklabs production only)');
