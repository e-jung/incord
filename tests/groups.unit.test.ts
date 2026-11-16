import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  generateInviteCode,
  INVITE_ALPHABET,
  normalizeInviteCode,
  groupHash,
  equalHash,
  resolveGroupGoal,
} from '../cloudflare/groups';
import { fixture } from './groups.fixture';
afterEach(() => vi.restoreAllMocks());
describe('Groups codes and catalog goals', () => {
  it('uses the exact alphabet, unbiased rejection, 16 characters and case/hyphen normalization', () => {
    expect(INVITE_ALPHABET).toBe('abcdefghjkmnpqrstuvwxyz23456789');
    const n = INVITE_ALPHABET.length;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
      array.fill(255);
      for (let i = 0; i < 16; i++) array[i] = i % n;
      return array;
    });
    const code = generateInviteCode();
    expect(code).toBe(INVITE_ALPHABET.slice(0, 16));
    expect(normalizeInviteCode(code.toUpperCase().match(/.{4}/g)!.join('-'))).toBe(code);
    expect(() => normalizeInviteCode('o'.repeat(16))).toThrow();
  });
  it('hashes code indexes and compares differing lengths and content', async () => {
    const hash = await groupHash('abcd');
    expect(hash).toHaveLength(64);
    expect(equalHash(hash, await groupHash('abcd'))).toBe(true);
    expect(equalHash(hash, hash + 'a')).toBe(false);
    expect(equalHash(hash, await groupHash('abce'))).toBe(false);
  });
  it('validates only catalog IDs, ranges and metadata-only ESV goals', async () => {
    const f = fixture();
    for (const selection of [
      { kind: 'passage', id: 'unknown', translation: 'BSB' },
      { kind: 'passage', id: 'psalm-23', translation: 'NIV' },
      { kind: 'passage', id: 'psalm-23', translation: 'BSB', text: 'custom' },
      { kind: 'document', id: 'wsc', translation: 'BSB', start: 0 },
    ])
      await expect(resolveGroupGoal(f.env, selection)).rejects.toThrow();
    const esv = await resolveGroupGoal(f.env, {
      kind: 'passage',
      id: 'psalm-23',
      translation: 'ESV',
    });
    expect(esv.goal.itemIds).toEqual(['esv-psa-23-1--esv-psa-23-6']);
    expect(esv.items[0].text).toBe('');
    expect(JSON.stringify(esv.goal)).not.toContain('He makes me');
    const bsb = await resolveGroupGoal(f.env, {
      kind: 'passage',
      id: 'psalm-23',
      translation: 'BSB',
    });
    expect(bsb.goal.itemIds).toEqual(['bsb-psa-23-1--bsb-psa-23-6']);
    const doc = await resolveGroupGoal(f.env, {
      kind: 'document',
      id: 'wsc',
      translation: 'BSB',
      start: 1,
      end: 2,
    });
    expect(doc.goal.itemIds).toEqual(['wsc-1', 'wsc-2']);
    const topic = await resolveGroupGoal(f.env, {
      kind: 'topic',
      id: 'topic-prayer',
      translation: 'KJV',
    });
    expect(topic.goal.total).toBe(7);
    expect(topic.goal.itemIds.every((id: string) => id.startsWith('kjv-'))).toBe(true);
    const starter = await resolveGroupGoal(f.env, {
      kind: 'starter',
      id: 'gospel',
      translation: 'WEB',
    });
    expect(starter.goal.total).toBe(10);
    expect(starter.goal.itemIds.every((id: string) => id.startsWith('web-'))).toBe(true);
  });
});
