import { deployment } from '../deployment';
import { loadSettings, serverSettings, settingsDefaults } from '../../shared/domain/settings';
import { assertEsvLimit, stripEsvText } from '../esv';
import { GroupsError } from '../groups';
import { ApiError, assert, json } from './common';
import {
  endpointHash,
  pushReason,
  PushResult,
  PushSubscriptionData,
  sendWebPush,
  validateSubscription,
} from './push';
import {
  localDay,
  mergeServerSettings,
  record,
  settingsRecord,
  SyncRecord,
  timestamp,
} from './settings';
import { Env, ObjectData, Row } from './types';

export class UserDO {
  private sql: SqlStorage;
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    // Retained for existing DO schema compatibility only; authentication never reads/writes it.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,value TEXT NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,value TEXT NOT NULL,updated INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,value TEXT NOT NULL)',
    );
  }
  private rows(query: string, ...args: (string | number)[]) {
    return [...this.sql.exec<Row>(query, ...args)];
  }
  private get(key: string): any {
    const row = this.rows('SELECT value FROM meta WHERE key=?', key)[0];
    return row ? JSON.parse(String(row.value)) : null;
  }
  private set(key: string, value: unknown) {
    this.sql.exec(
      'INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  private list(table: string) {
    assert(['items', 'events', 'subscriptions'].includes(table));
    return this.rows(
      `SELECT value FROM ${table} ORDER BY ${table === 'subscriptions' ? 'endpoint' : 'id'}`,
    ).map((row) => JSON.parse(String(row.value)));
  }
  private settings() {
    const stored = this.get('settings') || {},
      settings = serverSettings(loadSettings(stored));
    // Profile names predate synced preferences: keep the existing profile fallback.
    if (stored.name === undefined && stored.displayName === undefined) {
      delete settings.name;
      delete settings.displayName;
      delete settings.fieldUpdatedAt?.name;
      delete settings.fieldUpdatedAt?.displayName;
    }
    return settings;
  }
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const data = await request.json<any>(),
          path = new URL(request.url).pathname;
        if (path === '/maintenance/metadata')
          return json({ createdAt: this.get('profile')?.createdAt ?? null });
        if (path === '/delete') {
          await this.ctx.storage.deleteAll();
          this.sql.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
          this.set('deleted', true);
          return json({ ok: true });
        }
        assert(!this.get('deleted'), 'Account no longer exists', 401);
        if (path === '/init') {
          if (!this.get('profile')) {
            this.set('profile', {
              id: this.ctx.id.toString(),
              displayName: data.name || 'Friend',
              createdAt: Date.now(),
            });
            this.set('version', 1);
          }
          return json({ ok: true });
        }
        assert(this.get('profile'), 'Account not found', 401);
        if (path === '/me') {
          const profile = this.get('profile');
          return json({
            user: {
              ...profile,
              displayName:
                this.settings().displayName === undefined
                  ? profile.displayName
                  : this.settings().displayName || 'Friend',
              settings: this.settings(),
            },
            version: this.get('version'),
            mcpCountsEnabled: this.get('mcpCountsEnabled') !== false,
          });
        }
        if (path === '/revoke') {
          this.set('version', this.get('version') + 1);
          return json({ ok: true });
        }
        if (path === '/mcp/privacy') {
          assert(typeof data.enabled === 'boolean');
          this.set('mcpCountsEnabled', data.enabled);
          return json({ ok: true });
        }
        if (path === '/mcp/add' || path === '/groups/add') {
          assert(
            data.version === undefined || data.version === this.get('version'),
            'Session expired',
            401,
          );
          assert(
            Array.isArray(data.items) && data.items.length <= 10000,
            'Too many verses in one call',
          );
          const results: any[] = [],
            admitted: any[] = [],
            existing = new Map(this.list('items').map((i) => [i.id, i]));
          // Insert-if-absent and device sync share the same merge, caps and ESV path.
          // One batch transaction avoids re-reading the whole library for every verse.
          for (const source of data.items) {
            assert(source && typeof source.id === 'string', 'Invalid item');
            const old = existing.get(source.id);
            if (old && !old.deleted) {
              results.push({ id: source.id, status: 'already in library' });
              continue;
            }
            // A low initial revision lets an unsynced device's existing practice win.
            const now = Date.now(),
              item = stripEsvText({
                ...source,
                origin: path === '/groups/add' ? 'group' : 'mcp',
                step: 1,
                learned: false,
                deleted: false,
                due: new Date(now).toISOString(),
                createdAt: new Date(now).toISOString(),
                updatedAt: old ? timestamp(old.updatedAt) + 1 : 1,
              });
            try {
              record(item);
              assert(existing.has(item.id) || existing.size < 10000, 'Account item limit reached');
              if (item.translation === 'ESV' || item.id.startsWith('esv-'))
                try {
                  assertEsvLimit(
                    [...existing.values()].filter((i) => i.id !== item.id).concat(item),
                  );
                } catch (error) {
                  throw new ApiError(
                    400,
                    error instanceof Error ? error.message : 'ESV limit reached',
                  );
                }
              existing.set(item.id, item);
              admitted.push(item);
              results.push({ id: item.id, status: 'added' });
            } catch (error) {
              if (error instanceof ApiError)
                results.push({ id: source.id, status: 'invalid reference', reason: error.message });
              else throw error;
            }
          }
          this.mergeData(admitted, [], null);
          return json({ results });
        }
        if (path === '/sync') {
          const incomingItems = data.items || [],
            events = data.events || [];
          assert(Array.isArray(incomingItems), 'Invalid items');
          const items = incomingItems.map((item: any) =>
            item && typeof item.id === 'string' ? stripEsvText(item) : item,
          );
          assert(
            Array.isArray(items) &&
              items.length <= 1000 &&
              Array.isArray(events) &&
              events.length <= 2000,
            'Sync batch too large',
          );
          for (const item of items) record(item);
          for (const event of events) {
            assert(
              event &&
                typeof event.id === 'string' &&
                event.id.length > 0 &&
                event.id.length <= 160 &&
                JSON.stringify(event).length <= 10_000,
              'Invalid event',
            );
            assert(
              event.timestamp !== undefined ||
                event.createdAt !== undefined ||
                event.at !== undefined,
              'Event needs timestamp, createdAt, or at',
            );
            timestamp(event.timestamp ?? event.createdAt ?? event.at);
          }
          const settings = data.settings ? settingsRecord(data.settings) : null;
          this.mergeData(items, events, settings);
          return json({
            items: this.list('items'),
            events: this.list('events'),
            settings: this.settings(),
            serverTime: Date.now(),
          });
        }
        if (path === '/groups/attention') {
          // Count distinct senders by the recipient's local day, independent of UTC dedup.
          // Legacy reservations have no received timestamp, so cannot be dated locally.
          // Return only a count; sender hashes, notification text and tags stay private.
          const settings = this.settings();
          if (settings.groupReceivePrayer === false) return json({ prayersToday: 0 });
          const timezone = settings.timezone || 'UTC',
            day = localDay(new Date(Date.now()), timezone);
          const prayersToday = this.rows(
            "SELECT value FROM meta WHERE key GLOB 'group-prayer-received:*'",
          ).filter((row) => {
            const received = JSON.parse(String(row.value));
            return (
              typeof received === 'number' &&
              Number.isFinite(received) &&
              localDay(new Date(received), timezone) === day
            );
          }).length;
          return json({ prayersToday });
        }
        if (path === '/groups/state')
          return json({
            name: this.get('profile').displayName,
            settings: this.settings(),
            items: this.list('items').map(
              ({ id, title, reference, translation, learned, deleted }: any) => ({
                id,
                title,
                reference,
                translation,
                learned,
                deleted,
              }),
            ),
            events: this.list('events').map(({ at, timestamp, createdAt }: any) => ({
              at: at ?? timestamp ?? createdAt,
            })),
          });
        if (path === '/groups/push' || path === '/groups/prayer') {
          if (path === '/groups/prayer') {
            assert(
              typeof data.senderHash === 'string' &&
                /^[a-f0-9]{64}$/.test(data.senderHash) &&
                data.kind === 'prayer',
              'Invalid prayer',
            );
            // Recipient DO + stable sender hash is an ordered, cross-group pair.
            // Reserve before preferences/delivery, without awaits or delivery receipts.
            const key = 'group-prayer:' + data.senderHash,
              received = Date.now(),
              day = new Date(received).toISOString().slice(0, 10);
            if (this.get(key) === day) return json({ ok: true, alreadySent: true });
            this.set(key, day);
            this.set('group-prayer-received:' + data.senderHash, received);
          }
          const settings = this.settings();
          if (
            !(settings.remindersEnabled ?? settings.pushEnabled) ||
            !this.env.VAPID_PRIVATE_KEY ||
            !this.env.VAPID_PUBLIC_KEY ||
            (data.kind === 'prayer' && settings.groupReceivePrayer === false)
          )
            return json({ ok: true });
          for (const sub of this.list('subscriptions')) {
            try {
              const response = await sendWebPush(
                sub,
                { title: 'Incord', body: String(data.body).slice(0, 400), url: '/', tag: data.tag },
                this.env,
              );
              if (response.status === 404 || response.status === 410)
                this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', sub.endpoint);
            } catch {
              /* Delivery failures never reveal subscription data. */
            }
          }
          return json({ ok: true });
        }
        if (path === '/mcp/state')
          return json({
            items: this.list('items'),
            settings: this.settings(),
            events: data.events
              ? this.list('events').map(({ itemId, at, mode }) => ({ itemId, at, mode }))
              : [],
          });
        if (path === '/export')
          return json({
            format: 'by-heart',
            version: 1,
            exportedAt: new Date().toISOString(),
            user: {
              ...this.get('profile'),
              displayName:
                this.settings().displayName === undefined
                  ? this.get('profile').displayName
                  : this.settings().displayName || 'Friend',
            },
            items: this.list('items'),
            events: this.list('events'),
            settings: this.settings(),
          });
        if (path === '/push/subscribe') {
          const migration = deployment(this.env).migration;
          if (data.subscription === null || data.enabled === false) {
            if (data.endpoint)
              this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', data.endpoint);
            else this.sql.exec('DELETE FROM subscriptions');
            return json({ ok: true });
          }
          const sub = (data.subscription || data) as PushSubscriptionData;
          validateSubscription(sub);
          assert(
            this.list('subscriptions').filter(
              (existing) =>
                !migration ||
                data.origin !== migration.origin ||
                (existing.origin && existing.origin !== migration?.legacyOrigin),
            ).length < 5 ||
              this.rows('SELECT endpoint FROM subscriptions WHERE endpoint=?', sub.endpoint).length,
            'Device limit reached',
          );
          // Keep legacy subscriptions until their replacement has been accepted.
          this.sql.exec(
            'INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET value=excluded.value',
            sub.endpoint,
            JSON.stringify({ ...sub, origin: data.origin }),
          );
          if (migration && data.origin === migration.origin)
            for (const old of this.list('subscriptions'))
              if (!old.origin || old.origin === migration?.legacyOrigin)
                this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', old.endpoint);
          return json({ ok: true });
        }
        if (path === '/push/status') {
          const migration = deployment(this.env).migration;
          const endpointHashes = await Promise.all(
            this.list('subscriptions').map((sub) => endpointHash(sub.endpoint)),
          );
          return json({
            subscribed: !!data.endpointHash && endpointHashes.includes(data.endpointHash),
            endpointHashes,
            oldOriginOnly:
              !!migration &&
              this.list('subscriptions').length > 0 &&
              this.list('subscriptions').every(
                (sub) => !sub.origin || sub.origin === migration?.legacyOrigin,
              ),
            results: this.get('pushResults') || [],
          });
        }
        if (path === '/push/test') return json(await this.sendPush(true));
        if (path === '/push/remind') return json(await this.sendPush(false));
        return json({ error: 'Not found' }, 404);
      } catch (e) {
        if (e instanceof ApiError || e instanceof GroupsError)
          return json({ error: e.message }, e.status);
        throw e;
      }
    });
  }
  private mergeData(items: any[], events: any[], settings: any) {
    this.ctx.storage.transactionSync(() => {
      assert(
        Number(this.rows('SELECT COUNT(*) AS n FROM items')[0].n) +
          items.filter(
            (i: SyncRecord) => !this.rows('SELECT id FROM items WHERE id=?', i.id).length,
          ).length <=
          10_000,
        'Account item limit reached',
      );
      assert(
        Number(this.rows('SELECT COUNT(*) AS n FROM events')[0].n) +
          events.filter(
            (e: ObjectData) => !this.rows('SELECT id FROM events WHERE id=?', String(e.id)).length,
          ).length <=
          100_000,
        'Account review log limit reached',
      );
      const prospective = new Map(this.list('items').map((item) => [item.id, item]));
      for (const item of items) {
        const old = prospective.get(item.id);
        if (
          !old ||
          timestamp(item.updatedAt) > timestamp(old.updatedAt) ||
          (timestamp(item.updatedAt) === timestamp(old.updatedAt) &&
            JSON.stringify(item) > JSON.stringify(old))
        )
          prospective.set(item.id, item);
      }
      try {
        assertEsvLimit([...prospective.values()]);
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : 'ESV limit reached');
      }
      for (const item of items as SyncRecord[]) {
        const serialized = JSON.stringify(item),
          updated = timestamp(item.updatedAt);
        const existing = this.rows('SELECT updated,value FROM items WHERE id=?', item.id)[0];
        // Equal-timestamp conflicts converge deterministically, independent of arrival order.
        if (
          !existing ||
          updated > Number(existing.updated) ||
          (updated === Number(existing.updated) && serialized > String(existing.value))
        )
          this.sql.exec(
            'INSERT INTO items VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated=excluded.updated',
            item.id,
            serialized,
            updated,
          );
      }
      for (const event of events)
        this.sql.exec('INSERT OR IGNORE INTO events VALUES(?,?)', event.id, JSON.stringify(event));
      // Runtime fallbacks are not stored preferences and must not win a zero-clock tie.
      if (settings) this.set('settings', mergeServerSettings(this.get('settings') || {}, settings));
    });
  }
  private async sendPush(test: boolean) {
    assert(this.env.VAPID_PRIVATE_KEY && this.env.VAPID_PUBLIC_KEY, 'Push is not configured', 503);
    const settings = this.settings(),
      now = new Date(),
      today = localDay(now, settings.timezone || 'UTC');
    let dueCount = 0;
    if (!test) {
      if (!settings.remindersEnabled || this.get('remindedDay') === today)
        return { sent: 0, failed: 0, results: [] };
      const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone: settings.timezone || 'UTC',
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(now);
      // Cron is quarter-hourly: permit the 15-minute window following the chosen time.
      const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      const delta =
        (minutes(clock) -
          minutes(settings.reminderTime || settingsDefaults().reminderTime) +
          1440) %
        1440;
      if (delta >= 15) return { sent: 0, failed: 0, results: [] };
      if (
        this.list('events').some(
          (e) =>
            localDay(new Date(e.timestamp ?? e.createdAt ?? e.at), settings.timezone || 'UTC') ===
            today,
        )
      )
        return { sent: 0, failed: 0, results: [] };
      dueCount = this.list('items').filter(
        (i) =>
          !i.deleted &&
          (!i.learned ||
            (!i.due && !i.dueAt && !i.card?.due) ||
            new Date(i.dueAt ?? i.due ?? i.card?.due).getTime() <= now.getTime()),
      ).length;
      if (!dueCount) return { sent: 0, failed: 0, results: [] };
      this.set('remindedDay', today); // Reserve before network I/O, so retries cannot duplicate a daily reminder.
    }
    let sent = 0,
      failed = 0;
    const results: PushResult[] = [];
    for (const sub of this.list('subscriptions')) {
      const started = Date.now(),
        host = new URL(sub.endpoint).hostname;
      let status = 0,
        reason = '';
      try {
        const response = await sendWebPush(
          sub,
          {
            title: 'Incord',
            body: test
              ? 'Test notification. Reminders are working.'
              : `You have ${dueCount} ${dueCount === 1 ? 'item' : 'items'} to practice today.`,
            url: '/',
            tag: test ? 'by-heart-test' : 'by-heart-daily',
            renotify: test,
          },
          this.env,
        );
        status = response.status;
        reason = await pushReason(response, sub, this.env);
        if (response.ok) sent++;
        else failed++;
        if (status === 404 || status === 410)
          this.sql.exec('DELETE FROM subscriptions WHERE endpoint=?', sub.endpoint);
      } catch (error) {
        failed++;
        reason =
          error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
            ? 'Push request timed out'
            : 'Push delivery failed';
      }
      const result = { time: Date.now(), host, status, reason };
      results.push(result);
      this.set('pushResults', [result, ...(this.get('pushResults') || [])].slice(0, 10));
      console.log(
        JSON.stringify({
          evt: 'push',
          kind: test ? 'test' : 'remind',
          host,
          status,
          reason,
          ms: Date.now() - started,
        }),
      );
    }
    return { sent, failed, results };
  }
}
