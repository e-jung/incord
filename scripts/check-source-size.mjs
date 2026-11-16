import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Explicit non-source exclusions: generated Scripture/content, upstream snapshots,
// dependency lockfile, license texts and generated SVG artwork. No source owners
// are exempted. Documentation prose is not handwritten executable source.
const excluded = ['public/content/', 'content/', 'public/licenses/'];
const source = /\.(?:ts|js|mjs|svelte|css|html|py|sh)$/;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
}).trim().split('\n');
const errors = [];
for (const file of new Set(files)) {
  if (!source.test(file) || excluded.some(prefix => file.startsWith(prefix))) continue;
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  if (lines.length > 1000) errors.push(`${file}: ${lines.length} lines (limit 1000)`);
  lines.forEach((line, index) => {
    if (line.length > 200) errors.push(`${file}:${index + 1}: ${line.length} characters (limit 200)`);
  });
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Source budget: <=1000 lines/file, <=200 characters/line.');
