import { handleFeedbackRegistry, initializeFeedbackStorage } from '../feedback';
import { GroupsError, handleGroupsRegistry, initializeGroupsRegistry } from '../groups';
import { ApiError, assert, constantTimeEqual, json } from './common';
import { Env, Row } from './types';

export class RegistryDO {
  private sql: SqlStorage;
  constructor(
    private ctx: DurableObjectState,
    private env: Env = {} as Env,
  ) {
    this.sql = ctx.storage.sql;
    initializeFeedbackStorage(this.sql);
    initializeGroupsRegistry(this.sql);
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS mapping(kind TEXT NOT NULL,id TEXT NOT NULL,uid TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS mapping_user ON mapping(uid)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS email_codes(id TEXT PRIMARY KEY,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL,uid TEXT)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS email_test(id TEXT PRIMARY KEY,code TEXT NOT NULL,expires INTEGER NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS schedule(uid TEXT PRIMARY KEY,next_at INTEGER NOT NULL)',
    );
    // Durable index + tombstones. Existing accounts are discoverable only from
    // references the registry actually retained, not by enumerating UserDO ids.
    // state: 0 active, 1 deletion claimed (no new identity links), 2 deleted.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS accounts(uid TEXT PRIMARY KEY,state INTEGER NOT NULL DEFAULT 0,claim_until INTEGER NOT NULL DEFAULT 0)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS code_revisions(uid TEXT PRIMARY KEY,revision TEXT NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS accounts_import_attempts(uid TEXT PRIMARY KEY,attempted INTEGER NOT NULL)',
    );
    this.indexAccounts();
  }
  private rows(query: string, ...args: (string | number)[]) {
    return [...this.sql.exec<Row>(query, ...args)];
  }
  private indexAccounts() {
    this.sql.exec(`INSERT OR IGNORE INTO accounts(uid)
      SELECT uid FROM mapping UNION SELECT uid FROM schedule
      UNION SELECT uid FROM email_codes WHERE uid IS NOT NULL
      UNION SELECT json_extract(value,'$.uid') FROM challenges WHERE json_type(value,'$.uid')='text'
      UNION SELECT json_extract(member.value,'$.uid') FROM groups_registry, json_each(groups_registry.value,'$.members') AS member
        WHERE json_type(member.value,'$.uid')='text'`);
  }
  private assertActive(uid: string) {
    assert(
      !this.rows('SELECT state FROM accounts WHERE uid=? AND state<>0', uid).length,
      'Account no longer exists',
      401,
    );
  }
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const data = await request.json<any>(),
          path = new URL(request.url).pathname,
          now = Date.now();
        if (path === '/maintenance/orphans') {
          this.indexAccounts();
          const eligible =
            "FROM accounts a WHERE state<2 AND NOT EXISTS (SELECT 1 FROM mapping m WHERE m.uid=a.uid AND m.kind IN ('email','google','code','jl'))";
          return json({
            indexedAccounts: Number(
              this.rows('SELECT count(*) AS n FROM accounts WHERE state<2')[0].n,
            ),
            orphanAccounts: Number(this.rows('SELECT count(*) AS n ' + eligible)[0].n),
            users: this.rows(
              'SELECT uid ' + eligible + ' ORDER BY state DESC,uid LIMIT ?',
              data.limit,
            ).map((r) => r.uid),
          });
        }
        if (path === '/maintenance/claim') {
          // This check and the durable claim are serialized with ALL mapping writes.
          // A claim survives failed cleanup and is retryable; linking cannot resurrect it.
          const row = this.rows(
            "SELECT uid FROM accounts WHERE uid=? AND state<2 AND claim_until<=? AND NOT EXISTS (SELECT 1 FROM mapping WHERE uid=? AND kind IN ('email','google','code','jl'))",
            data.uid,
            now,
            data.uid,
          )[0];
          if (row)
            this.sql.exec(
              'UPDATE accounts SET state=1,claim_until=? WHERE uid=?',
              now + 300_000,
              data.uid,
            );
          return json({ claimed: !!row });
        }
        if (path === '/maintenance/release') {
          this.sql.exec('UPDATE accounts SET claim_until=0 WHERE uid=? AND state=1', data.uid);
          return json({ ok: true });
        }
        // An already-authenticated request may finish reading its body after
        // maintenance cleanup. Serialize the actor check with every group change
        // so claimed/deleted users cannot recreate membership after removal.
        if (
          path.startsWith('/groups/') &&
          path !== '/groups/cleanup' &&
          path !== '/groups/schedule'
        )
          this.assertActive(data.uid);
        const groups = await handleGroupsRegistry(this.sql, this.env, path, data);
        if (groups) return groups;
        const feedback = handleFeedbackRegistry(this.sql, this.ctx.storage, path, data, now);
        if (feedback) return feedback;
        this.sql.exec('DELETE FROM challenges WHERE expires < ?', now);
        this.sql.exec('DELETE FROM limits WHERE expires < ?', now);
        if (path === '/limit') {
          const row = this.rows('SELECT count FROM limits WHERE id=?', data.key)[0];
          assert(
            !row || Number(row.count) < data.limit,
            'Too many requests. Try again later.',
            429,
          );
          this.sql.exec(
            'INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',
            data.key,
            now + data.window,
          );
          return json({ ok: true });
        }
        if (path === '/challenge/set') {
          this.sql.exec(
            'INSERT INTO challenges VALUES(?,?,?)',
            data.id,
            JSON.stringify(data.value),
            now +
              (data.value?.kind === 'jl-return' && data.ttl === 1_800_000
                ? 1_800_000
                : data.ttl === 600_000
                  ? 600_000
                  : 300_000),
          );
          return json({ ok: true });
        }
        if (path === '/challenge/peek') {
          const row = this.rows('SELECT value FROM challenges WHERE id=?', data.id)[0];
          return json(row ? JSON.parse(String(row.value)) : null);
        }
        if (path === '/challenge/take') {
          const row = this.rows('SELECT value FROM challenges WHERE id=?', data.id)[0];
          this.sql.exec('DELETE FROM challenges WHERE id=?', data.id);
          return json(row ? JSON.parse(String(row.value)) : null);
        }
        if (path === '/jl/links')
          return json({
            subs: this.rows("SELECT id FROM mapping WHERE kind='jl' AND uid=?", data.uid).map(
              (r) => r.id,
            ),
          });
        if (path === '/jl/resolve') {
          assert(
            typeof data.sub === 'string' && /^jl1_[A-Za-z0-9_-]+$/.test(data.sub),
            'Invalid Jesklabs identity',
          );
          const old = this.rows("SELECT uid FROM mapping WHERE kind='jl' AND id=?", data.sub)[0];
          const email = data.emailKey
            ? this.rows("SELECT uid FROM mapping WHERE kind='email' AND id=?", data.emailKey)[0]
            : undefined;
          // Until legacy Google subjects are imported we cannot distinguish them
          // from new subjects: v1 intentionally does not disclose googleSub.
          // Existing mapped subjects/sessions and legacy Google remain usable.
          if (data.requireReady && !old)
            assert(
              !this.rows(
                "SELECT 1 FROM mapping g WHERE g.kind='google' AND NOT EXISTS(SELECT 1 FROM mapping j WHERE j.kind='jl' AND j.uid=g.uid) LIMIT 1",
              ).length,
              'Sign-in is temporarily unavailable. Please try again shortly.',
              503,
            );
          assert(
            !data.uid || ((!old || old.uid === data.uid) && (!email || email.uid === data.uid)),
            'That sign-in already belongs to another account.',
            409,
          );
          const uid = data.uid || old?.uid || email?.uid || crypto.randomUUID();
          this.assertActive(uid);
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('INSERT OR IGNORE INTO accounts(uid) VALUES(?)', uid);
            this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'jl', data.sub, uid);
            if (data.emailKey)
              this.sql.exec(
                'INSERT OR IGNORE INTO mapping VALUES(?,?,?)',
                'email',
                data.emailKey,
                uid,
              );
          });
          return json({ uid });
        }
        if (path === '/jl/import-list') {
          const missing =
            "FROM mapping g LEFT JOIN accounts_import_attempts a ON a.uid=g.uid WHERE g.kind='google' AND NOT EXISTS(SELECT 1 FROM mapping j WHERE j.kind='jl' AND j.uid=g.uid)";
          const google = Number(
            this.rows("SELECT count(*) n FROM mapping WHERE kind='google'")[0].n,
          );
          const unlinked = Number(this.rows('SELECT count(*) n ' + missing)[0].n);
          // Rotate failures behind untouched rows so a conflicting first batch
          // cannot starve the rest. Mark only confirmed batches, never dry runs.
          const rows = this.rows(
            'SELECT g.id,g.uid ' + missing + ' ORDER BY COALESCE(a.attempted,0),g.uid,g.id LIMIT ?',
            data.limit,
          );
          if (data.mark === true)
            this.ctx.storage.transactionSync(() => {
              for (const row of rows)
                this.sql.exec(
                  'INSERT INTO accounts_import_attempts VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET attempted=excluded.attempted',
                  row.uid,
                  now,
                );
            });
          return json({
            google,
            alreadyLinked: google - unlinked,
            rows,
            emailOnlyPendingLazy: Number(
              this.rows(
                "SELECT count(DISTINCT uid) n FROM mapping e WHERE kind='email' AND NOT EXISTS(SELECT 1 FROM mapping m WHERE m.uid=e.uid AND m.kind IN ('google','jl'))",
              )[0].n,
            ),
          });
        }
        if (path === '/identity') {
          const kinds = this.rows('SELECT DISTINCT kind FROM mapping WHERE uid=?', data.uid).map(
            (r) => r.kind,
          );
          const revision = this.rows(
            'SELECT revision FROM code_revisions WHERE uid=?',
            data.uid,
          )[0];
          return json({
            hasEmail: kinds.includes('email'),
            hasGoogle: kinds.includes('google'),
            hasCode: kinds.includes('code'),
            codeRevision: kinds.includes('code') ? revision?.revision || null : null,
          });
        }
        if (path === '/code/set') {
          this.assertActive(data.uid);
          if (this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'code', data.key).length)
            return json({ ok: false });
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('INSERT OR IGNORE INTO accounts(uid) VALUES(?)', data.uid);
            this.sql.exec('DELETE FROM mapping WHERE kind=? AND uid=?', 'code', data.uid);
            this.sql.exec('INSERT INTO mapping VALUES(?,?,?)', 'code', data.key, data.uid);
            this.sql.exec(
              'INSERT OR REPLACE INTO code_revisions VALUES(?,?)',
              data.uid,
              data.revision,
            );
          });
          return json({ ok: true });
        }
        if (path === '/code/signin') {
          const message = 'Unable to sign in with that code. Check it or try again later.';
          const row = this.rows(
            'SELECT id,uid FROM mapping WHERE kind=? AND id=?',
            'code',
            data.key,
          )[0];
          // Always compare equal-length HMACs, even on a registry miss.
          const match = constantTimeEqual(String(row?.id || '0'.repeat(43)), data.key);
          const failed = this.rows('SELECT count FROM limits WHERE id=?', 'code-global-failed')[0];
          // Global circuit breaker: at most 10,000 failures / 15 minutes across IPs.
          // Successful lookups do not spend the failed-attempt budget.
          assert(!failed || Number(failed.count) < 10_000, message, 429);
          if (!row || !match || data.valid !== true) {
            this.sql.exec(
              'INSERT INTO limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',
              'code-global-failed',
              now + 900_000,
            );
            throw new ApiError(401, message);
          }
          this.assertActive(String(row.uid));
          return json({ uid: row.uid });
        }
        if (path === '/code/remove') {
          this.assertActive(data.uid);
          assert(
            this.rows(
              "SELECT 1 FROM mapping WHERE uid=? AND kind IN ('email','google','jl')",
              data.uid,
            ).length,
            'Add email or Google before removing your code.',
            409,
          );
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM mapping WHERE kind=? AND uid=?', 'code', data.uid);
            this.sql.exec('DELETE FROM code_revisions WHERE uid=?', data.uid);
          });
          return json({ ok: true });
        }
        if (path === '/google') {
          const old = this.rows(
            'SELECT uid FROM mapping WHERE kind=? AND id=?',
            'google',
            data.sub,
          )[0];
          const email = data.emailKey
            ? this.rows('SELECT uid FROM mapping WHERE kind=? AND id=?', 'email', data.emailKey)[0]
            : undefined;
          assert(
            !data.uid || ((!old || old.uid === data.uid) && (!email || email.uid === data.uid)),
            'That Google account already belongs to another account.',
            409,
          );
          const uid = data.uid || old?.uid || email?.uid || crypto.randomUUID();
          this.assertActive(String(uid));
          this.sql.exec('INSERT OR IGNORE INTO accounts(uid) VALUES(?)', uid);
          this.sql.exec('INSERT OR IGNORE INTO mapping VALUES(?,?,?)', 'google', data.sub, uid);
          // An existing Google identity wins; never steal another account's email.
          if (data.emailKey)
            this.sql.exec(
              'INSERT OR IGNORE INTO mapping VALUES(?,?,?)',
              'email',
              data.emailKey,
              uid,
            );
          return json({ uid });
        }
        if (path === '/schedule/set') {
          this.assertActive(data.uid);
          this.sql.exec('INSERT OR IGNORE INTO accounts(uid) VALUES(?)', data.uid);
          this.sql.exec('INSERT OR IGNORE INTO schedule VALUES(?,0)', data.uid);
          return json({ ok: true });
        }
        if (path === '/schedule/due') {
          const users = this.rows(
            'SELECT uid FROM schedule WHERE next_at<=? ORDER BY next_at LIMIT 200',
            now,
          ).map((row) => row.uid);
          for (const uid of users)
            this.sql.exec('UPDATE schedule SET next_at=? WHERE uid=?', now + 15 * 60_000, uid);
          return json({ users });
        }
        if (path === '/delete') {
          this.sql.exec(
            'INSERT INTO accounts(uid,state) VALUES(?,2) ON CONFLICT(uid) DO UPDATE SET state=2',
            data.uid,
          );
          this.sql.exec('DELETE FROM mapping WHERE uid=?', data.uid);
          this.sql.exec('DELETE FROM code_revisions WHERE uid=?', data.uid);
          this.sql.exec('DELETE FROM accounts_import_attempts WHERE uid=?', data.uid);
          this.sql.exec("DELETE FROM challenges WHERE json_extract(value,'$.uid')=?", data.uid);
          this.sql.exec('DELETE FROM email_codes WHERE uid=?', data.uid);
          this.sql.exec('DELETE FROM schedule WHERE uid=?', data.uid);
          return json({ ok: true });
        }
        return json({ error: 'Not found' }, 404);
      } catch (e) {
        if (e instanceof ApiError || e instanceof GroupsError)
          return json({ error: e.message }, e.status);
        throw e;
      }
    });
  }
}
