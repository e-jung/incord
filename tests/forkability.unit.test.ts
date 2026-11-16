import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { deployment } from '../cloudflare/deployment';
import { accountsReturnPath } from '../cloudflare/accounts';

describe('neutral deployment and optional maintained adapter', () => {
  it('has no operator contacts, Accounts host or migration unless selected', () => {
    expect(deployment({})).toEqual({
      accountsOrigin: undefined,
      accountsClient: 'incord',
      emailFrom: undefined,
      feedbackTo: undefined,
      vapidSubject: '',
      migration: undefined,
    });
  });
  it('preserves maintained defaults while allowing explicit operator overrides', () => {
    const maintained = deployment({ DEPLOYMENT_ADAPTER: 'jesklabs' });
    expect(maintained).toMatchObject({
      accountsOrigin: 'https://accounts.jesklabs.com',
      feedbackTo: 'incord@jesklabs.com',
      emailFrom: 'Incord <hello@jesklabs.com>',
      vapidSubject: 'mailto:hello@jesklabs.com',
      migration: {
        origin: 'https://incord.jesklabs.com',
        legacyOrigin: 'https://byheart.jesklabs.com',
      },
    });
    expect(
      deployment({
        ACCOUNTS_ORIGIN: 'https://accounts.example.com',
        ACCOUNTS_CLIENT: 'fork',
        EMAIL_FROM: 'Fork <support@example.com>',
        FEEDBACK_TO: 'support@example.com',
        VAPID_SUBJECT: 'mailto:operator@example.com',
      }),
    ).toMatchObject({
      accountsOrigin: 'https://accounts.example.com',
      accountsClient: 'fork',
      emailFrom: 'Fork <support@example.com>',
      feedbackTo: 'support@example.com',
      vapidSubject: 'mailto:operator@example.com',
      migration: undefined,
    });
  });
  it('selects exactly the same defaults from the unchanged production APP_ORIGIN', () => {
    expect(deployment({ APP_ORIGIN: 'https://incord.jesklabs.com' })).toEqual(
      deployment({ DEPLOYMENT_ADAPTER: 'jesklabs' }),
    );
    expect(deployment({ APP_ORIGIN: 'https://fork.example.com' })).toEqual(deployment({}));
  });
  it('composes the identical effective pre-refactor production config with no added vars', () => {
    execFileSync(process.execPath, ['scripts/production-config.mjs']);
    const after = JSON.parse(readFileSync('wrangler.production.generated.json', 'utf8'));
    const before = ts.parseConfigFileTextToJson(
      'baseline',
      readFileSync('tests/fixtures/production-before-task3.jsonc', 'utf8'),
    ).config;
    before.vars.APP_ORIGIN = 'https://incord.jesklabs.com';
    expect(after).toEqual(before);
    expect(after.vars).not.toHaveProperty('DEPLOYMENT_ADAPTER');
  });
  it('rejects unknown adapters and unsafe browser Accounts origins', () => {
    expect(() => deployment({ DEPLOYMENT_ADAPTER: 'typo' })).toThrow();
    for (const origin of [
      'http://accounts.example.com',
      'https://accounts.example.com/path',
      'https://user:pass@accounts.example.com',
    ])
      expect(() => deployment({ ACCOUNTS_ORIGIN: origin })).toThrow();
  });
  it('keeps return paths on any self-hosted request origin, including deep-link queries', () => {
    expect(accountsReturnPath('/oauth/authorize?client_id=fork', 'https://fork.example.com')).toBe(
      '/oauth/authorize?client_id=fork',
    );
    for (const path of [
      '//accounts.example.com',
      '/\\evil.example.com',
      'https://incord.jesklabs.com/',
      '/\nattack',
    ])
      expect(accountsReturnPath(path, 'https://fork.example.com')).toBe('/');
  });
});
