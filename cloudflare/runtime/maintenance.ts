import { accountsCall, AccountsError } from '../accounts';
import { cleanupGroups } from '../groups';
import { oauthCall } from '../oauth-storage';
import { verifyStatsCookie } from '../stats';
import { cookies, originFor } from './auth';
import { ApiError, assert, body, constantTimeEqual, json, registry, user } from './common';
import { Env } from './types';

/** Both self-service deletion and maintenance must revoke apps before any destructive work. */
export async function deleteAccount(env: Env, uid: string, origin: string) {
  assert(
    (await oauthCall(env, '/revoke-all', { origin, uid })).ok,
    'Unable to disconnect apps. Please try again.',
    503,
  );
  const { subs } = await registry(env, '/jl/links', { uid });
  try {
    for (const sub of subs) await accountsCall(env.ACCOUNTS_SVC, 'deleteLink', { sub });
  } catch {
    console.log(JSON.stringify({ evt: 'accounts_delete_failed', count: subs.length }));
    throw new ApiError(503, 'Unable to disconnect Jesklabs sign-in. Please try again.');
  }
  await cleanupGroups(env, uid);
  await user(env, uid, '/delete'); // Includes push subscriptions, events, settings and credentials.
  await registry(env, '/delete', { uid });
}

export async function maintainOrphans(request: Request, env: Env) {
  assert(request.method === 'POST', 'Method not allowed', 405);
  const origin = originFor(request, env);
  assert(env.STATS_TOKEN && env.STATS_TOKEN.length >= 32, 'Stats are not configured', 503);
  // Reuse the stats sign-in throttle and signed administrator cookie. Bearer auth
  // also permits scripted use without putting the token in a URL or response.
  const stats = env.STATS.get(env.STATS.idFromName('stats'));
  assert(
    (await stats.fetch('https://stats/auth-limit', { method: 'POST' })).ok,
    'Try again in a minute',
    429,
  );
  const authorization = request.headers.get('Authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const authorized =
    (bearer !== undefined && constantTimeEqual(bearer, env.STATS_TOKEN)) ||
    (await verifyStatsCookie(cookies(request).incord_stats, env.STATS_TOKEN));
  assert(authorized, 'Unauthorized', 401);
  assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  const input = request.body ? await body(request, 4096) : {};
  assert(input.confirm === undefined || typeof input.confirm === 'boolean', 'Invalid confirmation');
  const limit = input.limit ?? 10;
  assert(
    Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 25,
    'Limit must be 1–25',
  );
  const report = await registry(env, '/maintenance/orphans', { limit });
  let deleted = 0,
    skipped = 0;
  const createdDates: (string | null)[] = [];
  for (const uid of report.users as string[]) {
    if (input.confirm === true && !(await registry(env, '/maintenance/claim', { uid })).claimed) {
      skipped++;
      continue;
    }
    try {
      const metadata = await user(env, uid, '/maintenance/metadata');
      createdDates.push(
        typeof metadata.createdAt === 'number'
          ? new Date(metadata.createdAt).toISOString().slice(0, 10)
          : null,
      );
      if (input.confirm === true) {
        await deleteAccount(env, uid, origin);
        deleted++;
      }
    } catch (error) {
      if (input.confirm === true) await registry(env, '/maintenance/release', { uid });
      throw error;
    }
  }
  return json({
    dryRun: input.confirm !== true,
    indexedAccounts: report.indexedAccounts,
    orphanAccounts: report.orphanAccounts,
    selectedAccounts: report.users.length,
    deletedAccounts: deleted,
    skippedAccounts: skipped,
    createdDates,
  });
}

export async function maintainAccountsImport(request: Request, env: Env) {
  assert(request.method === 'POST', 'Method not allowed', 405);
  const origin = originFor(request, env);
  assert(request.headers.get('Origin') === origin, 'Cross-origin write denied', 403);
  assert(env.STATS_TOKEN && env.STATS_TOKEN.length >= 32, 'Stats are not configured', 503);
  const stats = env.STATS.get(env.STATS.idFromName('stats'));
  assert(
    (await stats.fetch('https://stats/auth-limit', { method: 'POST' })).ok,
    'Try again in a minute',
    429,
  );
  const auth = request.headers.get('Authorization');
  assert(
    (auth?.startsWith('Bearer ') && constantTimeEqual(auth.slice(7), env.STATS_TOKEN)) ||
      (await verifyStatsCookie(cookies(request).incord_stats, env.STATS_TOKEN)),
    'Unauthorized',
    401,
  );
  const input = await body(request, 4096),
    limit = input.limit ?? 25;
  assert(input.confirm === undefined || typeof input.confirm === 'boolean', 'Invalid confirmation');
  assert(
    Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100,
    'Limit must be 1–100',
  );
  const selected = await registry(env, '/jl/import-list', { limit, mark: input.confirm === true });
  const report = {
    google: selected.google,
    imported: 0,
    alreadyLinked: selected.alreadyLinked,
    conflicts: 0,
    errors: 0,
    emailOnlyPendingLazy: selected.emailOnlyPendingLazy,
  };
  if (input.confirm === true)
    for (const row of selected.rows) {
      try {
        const metadata = await user(env, row.uid, '/maintenance/metadata');
        const stored = metadata.createdAt;
        const verifiedAt =
          typeof stored === 'number' &&
          Number.isFinite(stored) &&
          stored > 0 &&
          stored <= Date.now()
            ? stored
            : Date.now();
        const imported = await accountsCall(env.ACCOUNTS_SVC, 'importIdentity', {
          googleSub: row.id,
          verifiedAt,
        });
        await registry(env, '/jl/resolve', { sub: imported.sub, uid: row.uid });
        report.imported++;
      } catch (error) {
        if ((error instanceof ApiError || error instanceof AccountsError) && error.status === 409)
          report.conflicts++;
        else report.errors++;
      }
    }
  return json(report);
}
