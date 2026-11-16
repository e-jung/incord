// Cheap regression guard: operator addresses belong at optional deployment edges.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const forbidden = /(?:[a-z0-9-]+\.)*jesklabs\.com|ko-fi\.com\/jesklabs|Eric (?:reads|would)/i;
const failures = [];
function scan(dir) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (['cloudflare/adapters', 'cloudflare/legacy-redirect', 'cloudflare/test'].includes(path))
      continue;
    if (entry.isDirectory()) scan(path);
    else if (/\.(?:ts|svelte|js|jsonc)$/.test(path))
      readFileSync(resolve(root, path), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (forbidden.test(line))
            failures.push(
              `${relative(root, resolve(root, path))}:${i + 1}: operator-specific value in core`,
            );
        });
  }
}
for (const dir of ['src', 'cloudflare', 'shared']) scan(dir);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Core personal-value guard passed (optional adapters/legacy/test fixtures excluded).');
