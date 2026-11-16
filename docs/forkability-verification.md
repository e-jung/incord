# Forkability integration verification

Task 3 integrated on `refactor/debt-2026-11` against baseline `eac6108` on 2026-11-16.
No deployment, production secret change, remote Accounts request or live ESV request was performed.

## Exact production configuration parity

`node scripts/production-config.mjs` composes the neutral Wrangler base and optional
Jesklabs edge into the ignored root `wrangler.production.generated.json`. Keeping
that file beside the base preserves relative build, main and asset paths.

The generated object is **deeply identical, with no exclusions or added variables**,
to `git show eac6108:wrangler.jsonc` plus the `APP_ORIGIN` already supplied by the
old deploy command. In particular, production has no `DEPLOYMENT_ADAPTER` variable.
The runtime selects the maintained adapter from the existing exact
`APP_ORIGIN === jesklabs.appOrigin`; an explicit selector remains supported for
local fixtures and optional deployments. Other origins remain neutral.

Unchanged: Worker name `byheart`, entrypoint, compatibility date/flags, asset
configuration and dynamic routes, all five DO bindings/classes, all four additive
migrations, 15-minute cron, observability, `workers_dev=false`, canonical custom
domain, Accounts binding/entrypoint, Google switch, donation URL and origin.
Secrets and persistent storage/browser identities are untouched.

Migration array SHA256 (JSON serialization):
`a78d5e847366ebbb3c156459f9bbf9e2584cdf0257b34a2eb3d5e3b183f38d66`.

`tests/forkability.unit.test.ts` reproduces complete composition equality against
`tests/fixtures/production-before-task3.jsonc` (the unmodified baseline config),
including an explicit assertion that the selector variable is absent. To check
directly against Git rather than the fixture:

```sh
node scripts/production-config.mjs
node --input-type=module <<'JS'
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {deepStrictEqual} from 'node:assert';
const before = ts.parseConfigFileTextToJson('before', execFileSync(
  'git', ['show', 'eac6108:wrangler.jsonc'], {encoding:'utf8'})).config;
before.vars.APP_ORIGIN = 'https://incord.jesklabs.com';
const after = JSON.parse(readFileSync('wrangler.production.generated.json', 'utf8'));
deepStrictEqual(after, before);
console.log('Exact production parity: all fields and vars equal (no exclusions).');
JS
scripts/deploy.sh --dry-run --outdir /tmp/incord-task3-production
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run \
  --var APP_ORIGIN:https://fork.example.com --outdir /tmp/incord-task3-neutral
```

## Neutral boundaries

The README starts a fresh local instance with only `SESSION_SECRET`; the neutral
base has no Accounts binding, custom domain, donation link or operator contacts.
Code-account create/restore coverage removes the fake Accounts binding and test
mail switch, checks the neutral public config, then recovers the same identity.
The maintained-service sign-in button is omitted without an Accounts origin.
The print card uses the current instance host, Accounts return paths use the
request origin, and Accounts browser URLs/client IDs come from deployment config.

Feedback is stored without mail. Even a configured mail API key sends nothing
until a sender and recipient are available. Push contact and legacy-host/push
migration policy come from the optional adapter or explicit operator settings.
The historical redirect Worker remains unchanged. Runtime core personal-value
scanning runs in `npm run verify`; optional adapters, legacy Worker and fixtures
are the explicit edge exclusions.

## Evidence and scope

- Exact Git-baseline parity command passed; no fields removed from comparison.
- Production and neutral Wrangler 4.161.0 dry runs both exited successfully with
  `--dry-run: exiting now`; each read 252 asset files. Production exposed the
  identical bindings and three vars; neutral exposed no Accounts binding or
  maintained-service vars (only the example fork origin). Nothing was uploaded.
- `npm run verify` passed: formatting; zero app/Worker type errors or warnings;
  **624/624 unit tests across 41 files**, 100% engine coverage; content verification;
  production asset build; source budgets and core personal-value scan.
- The strengthened SESSION_SECRET-only code-account round-trip test also passed
  in a focused **15/15** code-auth rerun.
- All handwritten source is limited to 1,000 lines/file and 200 characters/line.
- Browser/end-to-end checks are intentionally reserved for the parent's final
  sequential browser suite; no new browser smoke is claimed here.

Local command logs: `/tmp/incord-task3-verify.log`,
`/tmp/incord-task3-production.log`, `/tmp/incord-task3-neutral.log`.
These are local evidence paths, not dependencies of the app or hosting guide.
