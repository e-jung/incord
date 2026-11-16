import {
  mergeSettings as mergeSharedSettings,
  serverSettings,
  settingsSchema,
} from '../../shared/domain/settings';
import { assert } from './common';
import { ObjectData } from './types';

export type SyncRecord = ObjectData & { id: string; updatedAt: number | string; deleted?: boolean };

export function timestamp(value: unknown) {
  const n = typeof value === 'string' ? Date.parse(value) : value;
  assert(
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Date.now() + 300_000,
    'Invalid updatedAt',
  );
  return n;
}

export function record(value: unknown): asserts value is SyncRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const r = value as ObjectData;
  assert(typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 160, 'Invalid id');
  assert(JSON.stringify(value).length <= 50_000, 'Item too large');
  timestamp(r.updatedAt);
}

export function localDay(now: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Internal aliases remain compatible with existing SQL records and server consumers. */
export function mergeServerSettings(old: any, incoming: any) {
  return serverSettings(mergeSharedSettings(old, incoming));
}

export function settingsRecord(input: unknown): ObjectData {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid settings');
  const raw = input as ObjectData;
  if (raw.fieldUpdatedAt !== undefined)
    assert(
      raw.fieldUpdatedAt &&
        typeof raw.fieldUpdatedAt === 'object' &&
        !Array.isArray(raw.fieldUpdatedAt),
      'Invalid field timestamps',
    );
  const s = serverSettings(raw);
  timestamp(s.updatedAt);
  const validated = settingsSchema.safeParse(s);
  assert(validated.success, validated.success ? '' : validated.error.issues[0].message);
  if (s.fieldUpdatedAt !== undefined)
    for (const value of Object.values(s.fieldUpdatedAt)) timestamp(value);
  assert(JSON.stringify(s).length < 10_000, 'Settings too large');
  return serverSettings(validated.data!);
}
