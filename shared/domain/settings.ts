import { z } from 'zod';

// The app CSP forbids eval; skip zod's `new Function` JIT probe, which reports a violation.
z.config({ jitless: true });

/** Canonical names are the browser names. Legacy server names exist only at the boundary. */
export type Settings = {
  groupShareTitles?: boolean;
  groupReceivePrayer?: boolean;
  defaultTranslation?: 'BSB' | 'KJV' | 'WEB' | 'ESV';
  keySounds?: boolean;
  haptics?: boolean;
  name: string;
  theme: string;
  textSize?: string;
  goal: number;
  reminderTime: string;
  timeZone: string;
  pushEnabled: boolean;
  days: string[];
  lastActive: string;
  returnStart?: string;
  updatedAt: number;
  fieldUpdatedAt?: Record<string, number>;
  newPerDay?: number;
};
type SettingsData = Partial<Settings> & Record<string, any>;
const aliases = {
  name: 'displayName',
  theme: 'appearance',
  goal: 'weeklyGoal',
  timeZone: 'timezone',
  pushEnabled: 'remindersEnabled',
} as const;
const retired = ['typingMode', 'peekNoteDismissed'];
const revision = z.number().finite().nonnegative();
const choice = <const T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.enum(values, { error: message });
const boolean = (message: string) => z.boolean({ error: message });
const limit = (values: number[], message: string) =>
  z.number().refine((value) => values.includes(value), message);
/** The single runtime schema; sync payloads are partial, never defaulted user edits. */
export const settingsSchema = z
  .object({
    name: z
      .string({ error: 'Invalid display name' })
      .max(80, 'Invalid display name')
      .transform((value) => value.trim()),
    theme: choice(['system', 'light', 'dark'], 'Invalid appearance'),
    textSize: choice(['small', 'default', 'large', 'extra-large'], 'Invalid text size'),
    goal: limit([3, 4, 5, 7], 'Invalid weekly goal'),
    newPerDay: limit([1, 2, 3, 5], 'Invalid daily limit'),
    defaultTranslation: choice(['BSB', 'KJV', 'WEB', 'ESV'], 'Invalid default translation'),
    reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid reminder time'),
    timeZone: z
      .string()
      .min(1, 'Invalid timezone')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone'),
    pushEnabled: boolean('Invalid reminder setting'),
    keySounds: boolean('Invalid keyboard feedback setting'),
    haptics: boolean('Invalid keyboard feedback setting'),
    groupShareTitles: boolean('Invalid group preference'),
    groupReceivePrayer: boolean('Invalid group preference'),
    days: z.array(z.string()),
    lastActive: z.string(),
    returnStart: z.string(),
    updatedAt: revision,
    fieldUpdatedAt: z.record(z.string(), revision),
  })
  .partial()
  .passthrough();

export function settingsDefaults(timeZone = 'UTC'): Settings {
  return {
    groupShareTitles: true,
    groupReceivePrayer: true,
    defaultTranslation: 'BSB',
    name: '',
    theme: 'system',
    textSize: 'default',
    goal: 4,
    newPerDay: 3,
    reminderTime: '19:00',
    timeZone,
    pushEnabled: false,
    keySounds: false,
    haptics: false,
    days: [],
    lastActive: '',
    updatedAt: 0,
  };
}
const clock = (settings: SettingsData, field: string): number =>
  settings.fieldUpdatedAt?.[field] ?? (settings.fieldUpdatedAt ? 0 : (settings.updatedAt ?? 0));

/** One migration boundary for persisted records and either generation of sync clients.
 * Missing clocks in a clocked record mean zero; unclocked legacy records use updatedAt.
 * A stored 09:00 is indistinguishable from an explicit choice and MUST be retained.
 */
export function migrateSettings(input: SettingsData): SettingsData {
  const result = { ...input };
  if (
    input.fieldUpdatedAt &&
    typeof input.fieldUpdatedAt === 'object' &&
    !Array.isArray(input.fieldUpdatedAt)
  )
    result.fieldUpdatedAt = { ...input.fieldUpdatedAt };
  for (const [canonical, alias] of Object.entries(aliases)) {
    const useAlias =
      input[alias] !== undefined &&
      (input[canonical] === undefined || clock(input, alias) > clock(input, canonical));
    if (useAlias) result[canonical] = input[alias];
    if (result.fieldUpdatedAt) {
      if (
        useAlias ||
        (result.fieldUpdatedAt[canonical] === undefined &&
          result.fieldUpdatedAt[alias] !== undefined)
      )
        result.fieldUpdatedAt[canonical] = clock(input, alias);
      delete result.fieldUpdatedAt[alias];
    }
    delete result[alias];
  }
  for (const field of retired) {
    delete result[field];
    if (result.fieldUpdatedAt) delete result.fieldUpdatedAt[field];
  }
  if (typeof result.name === 'string') result.name = result.name.trim();
  return result;
}

/** Fill absent fields without letting defaults inherit an old record's revision. */
export function loadSettings(input: SettingsData, timeZone = 'UTC'): Settings {
  const migrated = migrateSettings(input),
    defaults = settingsDefaults(timeZone);
  if (Object.keys(defaults).every((field) => migrated[field] !== undefined))
    return migrated as Settings;
  const result: SettingsData & { fieldUpdatedAt: Record<string, number> } = {
    ...migrated,
    fieldUpdatedAt: { ...migrated.fieldUpdatedAt },
  };
  for (const field of Object.keys(migrated))
    if (field !== 'updatedAt' && field !== 'fieldUpdatedAt')
      result.fieldUpdatedAt[field] = clock(migrated, field);
  for (const [field, value] of Object.entries(defaults))
    if (result[field] === undefined) {
      result[field] = value;
      if (field !== 'updatedAt') result.fieldUpdatedAt[field] = 0;
    }
  return result as Settings;
}

/** Emit compatibility names and clocks only at the server storage/API edge. */
export function serverSettings(input: SettingsData): SettingsData {
  const result = migrateSettings(input);
  for (const [canonical, alias] of Object.entries(aliases)) {
    if (result[canonical] !== undefined) result[alias] = result[canonical];
    if (result.fieldUpdatedAt?.[canonical] !== undefined)
      result.fieldUpdatedAt[alias] = result.fieldUpdatedAt[canonical];
  }
  return result;
}

/** Shared per-field LWW with deterministic value tie-breaking on both runtimes. */
export function mergeSettings(local: SettingsData, remote: SettingsData): SettingsData {
  local = migrateSettings(local);
  remote = migrateSettings(remote);
  const merged: SettingsData & { fieldUpdatedAt: Record<string, number> } = {
    ...local,
    fieldUpdatedAt: { ...local.fieldUpdatedAt },
  };
  for (const field of Object.keys(local))
    if (field !== 'updatedAt' && field !== 'fieldUpdatedAt')
      merged.fieldUpdatedAt[field] = clock(local, field);
  for (const field of Object.keys(remote)) {
    if (field === 'updatedAt' || field === 'fieldUpdatedAt') continue;
    const lt = clock(local, field),
      rt = clock(remote, field);
    if (
      rt > lt ||
      (rt === lt && (JSON.stringify(remote[field]) ?? '') > (JSON.stringify(local[field]) ?? ''))
    ) {
      merged[field] = remote[field];
      merged.fieldUpdatedAt[field] = rt;
    }
  }
  merged.updatedAt = Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0);
  return merged;
}

/** Item-only persistence never advances a preference clock. */
export function stampSettings(current: Settings, previous?: Settings, now = Date.now()): Settings {
  const migrated = migrateSettings(current);
  const next: SettingsData & { fieldUpdatedAt: Record<string, number> } = {
    ...migrated,
    fieldUpdatedAt: { ...migrated.fieldUpdatedAt },
  };
  if (!previous) return next as Settings;
  const before = migrateSettings(previous);
  next.updatedAt = before.updatedAt;
  for (const field of Object.keys(before))
    if (
      field !== 'updatedAt' &&
      field !== 'fieldUpdatedAt' &&
      next.fieldUpdatedAt[field] === undefined
    )
      next.fieldUpdatedAt[field] = clock(before, field);
  for (const field of Object.keys(next)) {
    if (field === 'updatedAt' || field === 'fieldUpdatedAt') continue;
    if (JSON.stringify(next[field]) !== JSON.stringify(before[field])) {
      next.fieldUpdatedAt[field] =
        (current.fieldUpdatedAt?.[field] ?? 0) > (before.fieldUpdatedAt?.[field] ?? 0)
          ? current.fieldUpdatedAt![field]
          : Math.max(now, (before.fieldUpdatedAt?.[field] ?? 0) + 1);
      next.updatedAt = Math.max(next.updatedAt ?? 0, next.fieldUpdatedAt[field]);
    }
  }
  return next as Settings;
}
