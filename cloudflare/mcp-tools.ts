import { z } from 'zod';
import { topics } from '../shared/topics';
import {
  passages,
  starters,
  documents,
  translations,
  lookupReference,
  resolveCatalogItem,
  rangeTitle,
  joinVerses,
  type Translation,
  type BookPack,
} from '../shared/domain/catalog';
import { canonicalCompare } from '../shared/domain/ordering';
import { dailyPlan } from '../shared/domain/planning';
import { assertEsvLimit, esvReferenceKeys, isEsv } from '../shared/esv';
import { gentleCap } from '../src/engine/today';
import { RULES } from '../src/config/rules';

export type McpToolDeps = {
  groups?: () => Promise<{ groups: any[] }>;
  assets: Fetcher;
  read: () => Promise<{ items: any[]; events: any[]; settings: any }>;
  add: (items: any[]) => Promise<any>;
  feedback?: (input: {
    kind: 'Idea' | 'Problem' | 'Other';
    message: string;
    contact?: string;
  }) => Promise<any>;
};
type Item = {
  id: string;
  title: string;
  text: string;
  collection: string;
  translation: string;
  reference?: string;
  esvVerseKeys?: string[];
  [key: string]: any;
};
const MAX_REFERENCE_VERSES = 500;
const MAX_ADD_ITEMS = 1000;
const DEVICE_NOTE =
  'ESV text is available only on your device. Open Incord to load and practice this passage.';
const translation = z.enum(['BSB', 'KJV', 'WEB', 'ESV']).default('BSB');
const passageInput = z
  .object({
    reference: z.string().trim().min(1).max(200).optional(),
    translation,
    as_one_passage: z
      .boolean()
      .default(false)
      .describe(
        'Join non-ESV verses into one item. ESV always remains one reference-only item regardless of this option.',
      ),
    title: z.string().trim().min(1).max(500).optional(),
    text: z.string().trim().min(1).max(100000).optional(),
    id: z.string().min(1).max(200).optional(),
    collection: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export const MCP_TOOL_SCHEMAS = {
  get_groups: {
    description:
      'Read your groups, shared goals, and members’ privacy-filtered practice rhythm and optional item titles. Never returns quotations, private review details, email addresses or account IDs. Cannot create, join or change groups.',
    inputSchema: z.object({}).strict(),
  },
  send_feedback: {
    description:
      'Send an idea, problem or other feedback to the Incord team. Message must be 10–4000 characters. Include contact only if the user explicitly wants an email reply; never infer it from account details. Does not include library contents or device metadata. Available with any valid connection, including read-only access.',
    inputSchema: z
      .object({
        kind: z.enum(['Idea', 'Problem', 'Other']),
        message: z.string().trim().min(10).max(4000),
        contact: z
          .string()
          .trim()
          .max(254)
          .refine(
            (value) =>
              !value ||
              (/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value) &&
                !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value)),
            'Enter a valid reply email.',
          )
          .optional(),
      })
      .strict(),
  },
  lookup_passage: {
    description:
      'Look up a Bible reference in bundled BSB, KJV or WEB. Each reference is limited to 500 verses. ESV is one reference-only item validated against bundled BSB coordinates; no ESV text is fetched or returned.',
    inputSchema: z.object({ reference: z.string().trim().min(1).max(200), translation }).strict(),
  },
  add_passages: {
    description:
      'Add up to 50 Bible references or custom title/text items. Strings are Bible references; objects can specify reference and translation, or a catalog id. Each reference is limited to 500 verses and each call to 1000 expanded items. as_one_passage joins each range; otherwise each verse is one item. ESV always stays one reference-only passage regardless of as_one_passage. Existing items retain all edits and progress.',
    inputSchema: z
      .object({
        items: z
          .array(
            z
              .unknown()
              .describe(
                'A reference string, {reference, translation?}, {title, text}, or {id} from list_collections. Inputs are validated independently.',
              ),
          )
          .min(1)
          .max(50),
        collection: z.string().trim().min(1).max(100).optional(),
        as_one_passage: z
          .boolean()
          .default(false)
          .describe(
            'Join non-ESV verses into one item. ESV always remains one reference-only item regardless of this option.',
          ),
      })
      .strict(),
  },
  list_library: {
    description:
      'List live library items, optionally filtered by collection. Never returns ESV quotations.',
    inputSchema: z
      .object({
        collection: z.string().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(1000).default(100),
      })
      .strict(),
  },
  get_due_today: {
    description:
      'Get the daily learning/review plan in the account timezone, respecting new-item allowance and gentle return.',
    inputSchema: z.object({}).strict(),
  },
  get_progress: {
    description:
      'Get library totals, practiced-day streak, and Monday-based weekly rhythm in the account timezone.',
    inputSchema: z.object({}).strict(),
  },
  list_collections: {
    description:
      'List bundled starters, ten Topics, the 17 curated Passages, catechisms and creeds, including item IDs and available metadata.',
    inputSchema: z.object({}).strict(),
  },
} as const;
/** All content requests stay on the provided static-assets binding, never the public network. */
async function asset<T>(deps: McpToolDeps, path: string): Promise<T> {
  const response = await deps.assets.fetch(
    new Request('https://incord-assets.invalid/content/' + path),
  );
  if (!response.ok) throw Error('Bundled content is unavailable.');
  return response.json() as Promise<T>;
}
function bookLoader(deps: McpToolDeps) {
  return (id: string, tr: Translation) => asset<BookPack>(deps, `${tr.toLowerCase()}/${id}.json`);
}
async function lookup(reference: string, tr: string, deps: McpToolDeps) {
  return lookupReference(reference, tr, bookLoader(deps), { maxVerses: MAX_REFERENCE_VERSES });
}
/** Allowlist output fields: stale/malicious ESV records cannot smuggle quotations through extra properties. */
function publicItem(item: any): any {
  const fields = [
    'id',
    'title',
    'text',
    'collection',
    'translation',
    'reference',
    'esvVerseKeys',
    'number',
    'lordsDay',
    'part',
    'parts',
    'heading',
    'step',
    'learned',
    'due',
    'createdAt',
    'learnedAt',
    'updatedAt',
    'origin',
  ];
  if (isEsv(item)) {
    const safeReference =
      typeof item.reference === 'string'
        ? item.reference
        : typeof item.title === 'string'
          ? item.title
          : '';
    let reference = '';
    let keys: string[] = [];
    try {
      keys = esvReferenceKeys(safeReference);
      reference = safeReference;
    } catch {
      /* Untrusted legacy metadata must not expose a quotation. */
    }
    return {
      id: String(item.id),
      title: reference || 'ESV passage',
      reference,
      esvVerseKeys: keys,
      text: '',
      collection: item.collection,
      translation: 'ESV',
      step: item.step,
      learned: item.learned,
      due: item.due,
      note: DEVICE_NOTE,
    };
  }
  return Object.fromEntries(fields.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]));
}
async function collections() {
  return {
    topics: topics.map((topic) => ({
      ...topic,
      id: `topic-${topic.id}`,
      itemCount: topic.verseCount,
      translations,
    })),
    starters: starters.map(({ items, ...meta }) => ({
      ...meta,
      itemCount: items.length,
      items: items.map(publicItem),
    })),
    passages: {
      id: 'passages',
      title: 'Passages',
      itemCount: passages.length,
      translations,
      items: passages,
    },
    documents: documents.map(({ items, ...meta }) => ({
      ...meta,
      itemCount: items.length,
      items: items.map(publicItem),
    })),
    translations,
    esvNote: DEVICE_NOTE,
  };
}
async function normalized(source: unknown, deps: McpToolDeps): Promise<Item[]> {
  const input = passageInput.parse(source);
  const modes = [!!input.reference, !!input.id, !!input.text].filter(Boolean).length;
  if (modes !== 1) throw Error('Supply exactly one of reference, catalog id, or custom text.');
  let items: Item[];
  if (input.reference) {
    items = await lookup(input.reference, input.translation, deps);
    if (input.as_one_passage && input.translation !== 'ESV') items = [joinVerses(items)];
  } else if (input.id) {
    items = await resolveCatalogItem(input.id, input.translation, bookLoader(deps), {
      maxVerses: MAX_REFERENCE_VERSES,
    });
  } else {
    if (!input.title) throw Error('Custom text requires a title.');
    if (input.translation === 'ESV') throw Error('ESV may only be added by reference.');
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify([input.title, input.text])),
    );
    const id =
      'own-mcp-' +
      Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
    items = [
      { id, title: input.title, text: input.text!, collection: 'personal', translation: '' },
    ];
  }
  return items.map((item) => ({
    ...item,
    collection: input.collection || item.collection,
    origin: 'mcp',
  }));
}
function zone(settings: any): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: settings?.timeZone });
    return settings?.timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
function day(date: Date, timeZone: string) {
  return date.toLocaleDateString('en-CA', { timeZone });
}
function shifted(date: string, days: number) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((Date.parse(a) - Date.parse(b)) / 86400000) || 0);
}
// Gentle-return policy belongs to the edge's settings adaptation; selection is shared.
function daily(items: any[], events: any[], settings: any, now: Date, timeZone: string) {
  const date = day(now, timeZone),
    newLimit = [1, 2, 3, 5].includes(Number(settings.newPerDay)) ? Number(settings.newPerDay) : 3;
  const daysAway = settings.lastActive ? daysBetween(date, settings.lastActive) : 0,
    rampDay = settings.returnStart ? daysBetween(date, settings.returnStart) : 7;
  const cap =
    daysAway >= 7 || (settings.returnStart && rampDay < 7)
      ? gentleCap(
          settings.returnStart && rampDay < 7 ? 7 : daysAway,
          daysAway >= 7 && rampDay >= 7 ? 0 : rampDay,
          RULES.daily.normalCap,
        )
      : Infinity;
  return dailyPlan(items, events, date, newLimit, now.getTime(), cap, timeZone);
}

export async function runMcpTool(name: string, args: unknown, deps: McpToolDeps): Promise<any> {
  if (!Object.hasOwn(MCP_TOOL_SCHEMAS, name)) throw Error('Unknown MCP tool.');
  const parsed: any = MCP_TOOL_SCHEMAS[name as keyof typeof MCP_TOOL_SCHEMAS].inputSchema.parse(
    args ?? {},
  );
  if (name === 'get_groups') {
    if (!deps.groups) throw Error('Groups are unavailable.');
    return deps.groups();
  }
  if (name === 'send_feedback') {
    if (!deps.feedback) throw Error('Feedback is unavailable.');
    return deps.feedback(parsed);
  }
  if (name === 'lookup_passage') {
    const verses = await lookup(parsed.reference, parsed.translation, deps);
    return {
      reference: rangeTitle(verses[0], verses[verses.length - 1]),
      translation: parsed.translation,
      count: verses.length,
      verses: verses.map(publicItem),
      ...(parsed.translation === 'ESV'
        ? { note: DEVICE_NOTE }
        : { text: verses.map((v) => v.text).join(' ') }),
    };
  }
  if (name === 'list_collections') return collections();
  if (name === 'add_passages') {
    const results: any[] = [],
      pending: Item[] = [];
    const state = await deps.read();
    let prospective = state.items;
    for (const [index, input] of parsed.items.entries()) {
      try {
        const source = typeof input === 'string' ? { reference: input } : input;
        const options =
          source && typeof source === 'object' && !Array.isArray(source)
            ? {
                as_one_passage: parsed.as_one_passage,
                ...(parsed.collection ? { collection: parsed.collection } : {}),
                ...source,
              }
            : source;
        const items = await normalized(options, deps);
        if (pending.length + items.length > MAX_ADD_ITEMS)
          throw Error('Each add call is limited to 1000 expanded items. Use smaller batches.');
        const ids = new Set(items.map((i) => i.id));
        const candidate = [
          ...prospective.filter((i) => !ids.has(i.id) || !i.deleted),
          ...items.filter((i) => !prospective.some((p) => p.id === i.id && !p.deleted)),
        ];
        assertEsvLimit(candidate);
        prospective = candidate;
        pending.push(...items);
        results.push({ index, status: 'pending', ids: items.map((i) => i.id) });
      } catch (error) {
        results.push({
          index,
          status: 'invalid reference',
          reason:
            error instanceof z.ZodError
              ? 'Invalid passage input.'
              : error instanceof Error
                ? error.message
                : 'Invalid passage input.',
        });
      }
    }
    if (pending.length) {
      try {
        const unique = [...new Map(pending.map((i) => [i.id, i])).values()];
        const out = await deps.add(unique);
        // The UserDO owns insertion, timestamps, progress preservation, and final caps.
        const statuses = Array.isArray(out) ? out : Array.isArray(out?.results) ? out.results : [];
        for (const result of results)
          if (result.status === 'pending') {
            result.results = result.ids.map((id: string) => {
              const status = statuses.find((s: any) => s.id === id);
              return {
                id,
                status: typeof status?.status === 'string' ? status.status : 'processed',
                ...(typeof (status?.reason ?? status?.error) === 'string'
                  ? { reason: status.reason ?? status.error }
                  : {}),
              };
            });
            result.status = result.results.some((r: any) => r.status === 'invalid reference')
              ? 'invalid reference'
              : result.results.some((r: any) => r.status === 'added')
                ? 'added'
                : result.results.every((r: any) =>
                      ['already in library', 'exists'].includes(r.status),
                    )
                  ? 'already in library'
                  : 'processed';
          }
      } catch (error) {
        for (const result of results)
          if (result.status === 'pending') {
            result.status = 'error';
            result.error = error instanceof Error ? error.message : 'Unable to add passages.';
          }
      }
    }
    return { results };
  }
  const state = await deps.read(),
    items = state.items.filter((i) => !i.deleted).sort(canonicalCompare),
    settings = state.settings || {},
    now = new Date(),
    timeZone = zone(settings),
    date = day(now, timeZone);
  if (name === 'list_library') {
    const filtered = items.filter((i) => !parsed.collection || i.collection === parsed.collection);
    return {
      items: filtered.slice(0, parsed.limit).map(publicItem),
      total: filtered.length,
      limit: parsed.limit,
    };
  }
  if (name === 'get_due_today') {
    const due = daily(items, state.events, settings, now, timeZone);
    return { date, timeZone, count: due.length, items: due.map(publicItem) };
  }
  const practiced = new Set<string>(
    (settings.days || []).filter(
      (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d),
    ),
  );
  for (const event of state.events)
    if (Number.isFinite(Date.parse(event.at))) practiced.add(day(new Date(event.at), timeZone));
  let streak = 0,
    cursor = practiced.has(date) ? date : shifted(date, -1);
  while (practiced.has(cursor)) {
    streak++;
    cursor = shifted(cursor, -1);
  }
  const monday = shifted(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shifted(monday, i);
    return { date, practiced: practiced.has(date) };
  });
  return {
    date,
    timeZone,
    total: items.length,
    learned: items.filter((i) => i.learned).length,
    learning: items.filter((i) => !i.learned).length,
    dueToday: daily(items, state.events, settings, now, timeZone).length,
    streak,
    weeklyRhythm: {
      goal: settings.goal || RULES.defaultRhythm,
      practicedDays: days.filter((d) => d.practiced && d.date <= date).length,
      days,
    },
  };
}
