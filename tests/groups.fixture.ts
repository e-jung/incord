import { expect } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RegistryDO, UserDO, type Env } from '../cloudflare/worker';
import { GroupDO, handleGroups } from '../cloudflare/groups';
function state() {
  const db = new DatabaseSync(':memory:');
  let tail = Promise.resolve();
  return {
    id: { toString: () => crypto.randomUUID() },
    storage: {
      sql: {
        exec(q: string, ...args: any[]) {
          const stmt = db.prepare(q);
          return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []);
        },
      },
      deleteAll: async () => {
        for (const row of db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as any[])
          db.exec('DROP TABLE ' + row.name);
      },
      transactionSync(fn: () => any) {
        db.exec('SAVEPOINT tx');
        try {
          const out = fn();
          db.exec('RELEASE tx');
          return out;
        } catch (error) {
          db.exec('ROLLBACK TO tx');
          db.exec('RELEASE tx');
          throw error;
        }
      },
    },
    blockConcurrencyWhile(fn: () => any) {
      const out = tail.then(fn);
      tail = out.catch(() => {});
      return out;
    },
  } as unknown as DurableObjectState;
}
export function fixture() {
  const env = {} as Env;
  const users = new Map<string, UserDO>(),
    groups = new Map<string, GroupDO>();
  const registry = new RegistryDO(state(), env);
  const scope = new AsyncLocalStorage<any>(),
    invocations: any[] = [],
    pushBodies: any[] = [],
    root = { calls: 0 },
    fault = { install: false };
  const namespace = (get: (id: string) => any, label = 'registry') =>
    ({
      idFromName: (id: string) => id,
      get: (id: string) => ({
        fetch: async (r: Request) => {
          (scope.getStore() || root).calls++;
          if (new URL(r.url).pathname === '/groups/push') pushBodies.push(await r.clone().json());
          if (fault.install && new URL(r.url).pathname === '/install')
            throw new Error('simulated installation failure');
          const invocation = { name: label + ':' + id, path: new URL(r.url).pathname, calls: 0 };
          invocations.push(invocation);
          return scope.run(invocation, () => get(id).fetch(r));
        },
      }),
    }) as unknown as DurableObjectNamespace;
  Object.assign(env, {
    SESSION_SECRET: 'groups-unit-test-secret-over-32-characters',
    REGISTRY: namespace(() => registry),
    GROUPS: namespace((id) => {
      if (!groups.has(id)) groups.set(id, new GroupDO(state(), env));
      return groups.get(id);
    }, 'group'),
    USERS: namespace((id) => {
      if (!users.has(id)) users.set(id, new UserDO(state(), env));
      return users.get(id);
    }, 'user'),
    ASSETS: {
      fetch: async (request: Request) => {
        try {
          return new Response(
            await readFile(resolve('public', new URL(request.url).pathname.slice(1))),
          );
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
  });
  const callUser = async (uid: string, path: string, data: any = {}) => {
    const response = await env.USERS.get(env.USERS.idFromName(uid)).fetch(
      new Request('https://internal' + path, { method: 'POST', body: JSON.stringify(data) }),
    );
    expect(response.ok).toBe(true);
    return response.json<any>();
  };
  const init = async (uid: string, settings: any = {}) => {
    await callUser(uid, '/init', { name: uid });
    if (Object.keys(settings).length)
      await callUser(uid, '/sync', { settings: { updatedAt: 1, ...settings } });
  };
  const api = async (uid: string, path = '', body: any = {}, method = 'POST', ip = uid) => {
    const response = await handleGroups(
      new Request('https://incord.test/api/groups' + path, {
        method,
        headers: { 'CF-Connecting-IP': ip },
      }),
      env,
      uid,
      body,
    );
    return response.json<any>();
  };
  return { env, api, init, callUser, groups, registry, invocations, root, fault, pushBodies };
}
export const item = (id: string, extra: any = {}) => ({
  id,
  title: 'John 3:16',
  text: 'Private text',
  collection: 'bible',
  translation: 'BSB',
  updatedAt: 1,
  ...extra,
});
