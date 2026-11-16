import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
if (existsSync('.dev.vars')) {
  console.log('.dev.vars already exists; preserved.');
  process.exit(0);
}
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]).toString('base64url');
writeFileSync(
  '.dev.vars',
  `SESSION_SECRET="${randomBytes(48).toString('base64url')}"\nSTATS_TOKEN="${randomBytes(32).toString('base64url')}"\nVAPID_PUBLIC_KEY="${publicKey}"\nVAPID_PRIVATE_KEY="${jwk.d}"\nVAPID_SUBJECT="mailto:local@example.test"\n`,
  { mode: 0o600 },
);
console.log('Created uncommitted local session/VAPID keys.');
