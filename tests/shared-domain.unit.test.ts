import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { canonical, sortItems } from '../shared/domain/ordering';
import { dailyPlan } from '../shared/domain/planning';
import {
  documents,
  lookupReference,
  passages,
  resolveCatalogItem,
  type BookLoader,
} from '../shared/domain/catalog';
import { runMcpTool } from '../cloudflare/mcp-tools';
import { resolveGroupGoal } from '../cloudflare/groups';

const loader: BookLoader = async (id, tr) =>
  JSON.parse(
    await readFile(
      new URL(`../public/content/${tr.toLowerCase()}/${id}.json`, import.meta.url),
      'utf8',
    ),
  );
const assets = {
  fetch: async (request: Request) =>
    new Response(
      await readFile(new URL('../public' + new URL(request.url).pathname, import.meta.url), 'utf8'),
    ),
} as unknown as Fetcher;

describe('shared catalog and planning contract', () => {
  it('resolves references with only an injected loader, never global fetch', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Network forbidden'));
    try {
      const verses = await lookupReference('III John 2-3', 'WEB', loader);
      expect(verses.map((v) => v.id)).toEqual(['web-3jn-1-2', 'web-3jn-1-3']);
      const esv = await lookupReference('Jn 3:16-18', 'ESV', loader);
      expect(esv[0]).toMatchObject({
        id: 'esv-jhn-3-16--esv-jhn-3-18',
        text: '',
        esvVerseKeys: ['jhn-3-16', 'jhn-3-17', 'jhn-3-18'],
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it('uses document source metadata even when saved question wording and numbers change', () => {
    const sources = documents.flatMap((d) => d.items);
    const a = { ...sources[0], title: 'Reworded question', number: 999 };
    expect(canonical(a)).toEqual([1, 0, sources[0].number || 0, sources[0].part || 0]);
    const items = [sources.at(-1)!, a];
    expect(sortItems(items)[0].id).toBe(a.id);
    expect(items[0].id).toBe(sources.at(-1)!.id);
  });

  it('shares review ties, timezone slot reservation and immutable ordering with MCP', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T01:00:00Z'));
    try {
      const base = {
        text: '',
        collection: 'bible',
        translation: 'BSB',
        learned: true,
        due: '2026-11-01',
      };
      const items = [
        { ...base, id: 'wsc-2', title: 'Edited wording' },
        { ...base, id: 'bsb-jhn-3-16', title: 'John 3:16' },
        { ...base, id: 'wsc-1', title: 'Edited wording' },
        { ...base, id: 'finished', title: 'Finished', due: '2026-12-01' },
        { ...base, id: 'new', title: 'New', learned: false },
      ];
      const events = [{ itemId: 'finished', at: '2026-11-14T00:00:00Z', mode: 'learning' }];
      const plan = dailyPlan(
        items,
        events,
        '2026-11-13',
        1,
        Date.now(),
        Infinity,
        'America/Los_Angeles',
      );
      expect(plan.map((i) => i.id)).toEqual(['bsb-jhn-3-16', 'wsc-1', 'wsc-2']);
      const out = await runMcpTool(
        'get_due_today',
        {},
        {
          assets,
          read: async () => ({
            items,
            events,
            settings: { timeZone: 'America/Los_Angeles', newPerDay: 1 },
          }),
          add: async () => {
            throw Error('Unexpected write');
          },
        },
      );
      expect(out.items.map((i: any) => i.id)).toEqual(plan.map((i) => i.id));
      expect(items[0].id).toBe('wsc-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['BSB', 'ESV'] as const)(
    'resolves group catalog goals directly with the same %s items',
    async (translation) => {
      const shared = await resolveCatalogItem(passages[0].id, translation, loader);
      const result = await resolveGroupGoal({ ASSETS: assets } as any, {
        kind: 'passage',
        id: passages[0].id,
        translation,
      });
      expect(result.items).toEqual(shared.map((item) => ({ ...item, origin: 'group' })));
      expect(result.goal.itemIds).toEqual(shared.map((item) => item.id));
    },
  );
});
