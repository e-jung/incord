import type { Env } from './worker';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

/** The provider deliberately uses its supported KV interface, backed by strongly
 * consistent SQLite. Whole OAuth operations are serialized here (not just each
 * get/put), so one-time codes and consent handles cannot be consumed twice. */
export class SqliteOAuthKV {
  constructor(private sql: SqlStorage) {
    sql.exec(
      'CREATE TABLE IF NOT EXISTS oauth_kv(name TEXT PRIMARY KEY,value TEXT NOT NULL,metadata TEXT,expiration INTEGER)',
    );
    sql.exec('CREATE INDEX IF NOT EXISTS oauth_expiration ON oauth_kv(expiration)');
  }
  private clean() {
    this.sql.exec(
      'DELETE FROM oauth_kv WHERE expiration IS NOT NULL AND expiration<=?',
      Math.floor(Date.now() / 1000),
    );
  }
  async get(name: string, options?: string | { type?: string }) {
    this.clean();
    const row = [
      ...this.sql.exec<{ value: string }>('SELECT value FROM oauth_kv WHERE name=?', name),
    ][0];
    if (!row) return null;
    const type = typeof options === 'string' ? options : options?.type;
    return type === 'json'
      ? JSON.parse(row.value)
      : type === 'arrayBuffer'
        ? new TextEncoder().encode(row.value).buffer
        : row.value;
  }
  async put(
    name: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ) {
    const exp =
      options?.expiration ??
      (options?.expirationTtl ? Math.floor(Date.now() / 1000) + options.expirationTtl : null);
    this.sql.exec(
      'INSERT INTO oauth_kv VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,metadata=excluded.metadata,expiration=excluded.expiration',
      name,
      value,
      options?.metadata === undefined ? null : JSON.stringify(options.metadata),
      exp,
    );
  }
  async delete(name: string) {
    this.sql.exec('DELETE FROM oauth_kv WHERE name=?', name);
  }
  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    this.clean();
    const prefix = options.prefix || '',
      limit = Math.min(1000, Math.max(1, options.limit || 1000)),
      cursor = options.cursor ? decodeURIComponent(options.cursor) : '';
    const rows = [
      ...this.sql.exec<{ name: string; metadata: string | null; expiration: number | null }>(
        'SELECT name,metadata,expiration FROM oauth_kv WHERE substr(name,1,?)=? AND name>? ORDER BY name LIMIT ?',
        prefix.length,
        prefix,
        cursor,
        limit + 1,
      ),
    ];
    const complete = rows.length <= limit,
      keys = rows
        .slice(0, limit)
        .map((row) => ({
          name: row.name,
          ...(row.expiration === null ? {} : { expiration: row.expiration }),
          ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) }),
        }));
    return {
      keys,
      list_complete: complete,
      cursor: complete ? '' : encodeURIComponent(keys.at(-1)!.name),
      cacheStatus: null,
    };
  }
}
export type McpIdentity = {
  uid: string;
  version: number;
  connectionId: string;
  statsEnabled: boolean;
  clientName?: string;
};
export class OAuthStorageDO {
  private kv: SqliteOAuthKV;
  constructor(private ctx: DurableObjectState) {
    this.kv = new SqliteOAuthKV(ctx.storage.sql);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS oauth_activity(id TEXT PRIMARY KEY,last_used INTEGER NOT NULL)',
    );
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const { OAuthAuthorizationServer, AuthorizationError, CimdFetchError } =
        await import('@cloudflare/workers-oauth-provider');
      this.ctx.storage.sql.exec(
        'DELETE FROM oauth_activity WHERE last_used<?',
        Date.now() - 31 * 86400000,
      );
      const data = await request.json<any>(),
        origin = data.origin as string;
      if (
        !/^https:\/\//.test(origin) &&
        !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)
      )
        return Response.json({ error: 'Invalid OAuth origin' }, { status: 400 });
      const server = new OAuthAuthorizationServer({
        issuer: origin,
        resources: [origin + '/mcp'],
        defaultResource: origin + '/mcp',
        authorizeEndpoint: '/oauth/authorize',
        tokenEndpoint: '/oauth/token',
        clientRegistrationEndpoint: '/oauth/register',
        scopesSupported: ['library:read', 'library:write'],
        clientIdMetadataDocumentEnabled: false,
        accessTokenTTL: 3600,
        refreshTokenTTL: 30 * 86400,
        clientRegistrationTTL: 30 * 86400,
        onError: () => undefined,
      });
      const env = { OAUTH_KV: this.kv },
        oauth: OAuthHelpers = server.getOAuthApi(env);
      const path = new URL(request.url).pathname;
      const original = () =>
        new Request(data.url, {
          method: data.method || 'GET',
          headers: data.headers,
          ...(data.body === undefined ? {} : { body: data.body }),
        });
      try {
        if (path === '/http')
          return await server.fetch(original(), env, this.ctx as unknown as ExecutionContext);
        if (path === '/consent') {
          const authRequest = await oauth.parseAuthRequest(original());
          if (!authRequest.scope.length) authRequest.scope = ['library:read', 'library:write'];
          if (authRequest.scope.some((s) => !['library:read', 'library:write'].includes(s)))
            return Response.json(
              { error: 'Choose library:read or library:write scopes.' },
              { status: 400 },
            );
          const details = await oauth.describeConsent(authRequest),
            consent = await oauth.beginConsent(authRequest);
          await this.kv.put(
            'incord-consent:' + (await handleKey(consent.handle)),
            JSON.stringify({ uid: data.uid, version: data.version }),
            { expirationTtl: 600 },
          );
          consent.headers.set('Content-Type', 'application/json');
          consent.headers.set('Cache-Control', 'no-store');
          return new Response(JSON.stringify({ ...details, handle: consent.handle }), {
            headers: consent.headers,
          });
        }
        if (path === '/decision') {
          const req = original(),
            bindingKey = 'incord-consent:' + (await handleKey(String(data.handle))),
            binding = await this.kv.get(bindingKey, { type: 'json' });
          if (!binding || binding.uid !== data.uid || binding.version !== data.version)
            return Response.json(
              { error: 'Sign-in changed. Start connecting again.' },
              { status: 400 },
            );
          if (data.decision === 'deny') {
            const denied = await oauth.denyConsent(req, data.handle);
            await this.kv.delete(bindingKey);
            denied.headers.delete('Location');
            denied.headers.set('Content-Type', 'application/json');
            return new Response(JSON.stringify({ redirectTo: denied.redirectTo }), {
              headers: denied.headers,
            });
          }
          if (data.decision !== 'approve')
            return Response.json({ error: 'Choose Approve or Deny.' }, { status: 400 });
          const approved = await oauth.approveConsent(req, data.handle);
          await this.kv.delete(bindingKey);
          if (
            !approved.request.scope.length ||
            approved.request.scope.some((s) => !['library:read', 'library:write'].includes(s))
          )
            return Response.json({ error: 'Unsupported scope' }, { status: 400 });
          const details = await oauth.describeConsent(approved.request),
            connectionId = crypto.randomUUID();
          const { redirectTo } = await oauth.completeAuthorization({
            request: approved.request,
            userId: data.uid,
            scope: approved.request.scope,
            metadata: { clientName: details.clientName, connectionId, connectedAt: Date.now() },
            props: {
              uid: data.uid,
              version: data.version,
              connectionId,
              statsEnabled: data.statsEnabled === true,
            } satisfies McpIdentity,
          });
          approved.headers.set('Content-Type', 'application/json');
          approved.headers.set('Cache-Control', 'no-store');
          return new Response(JSON.stringify({ redirectTo }), { headers: approved.headers });
        }
        if (path === '/validate') {
          const token = await server.validateToken(origin + '/mcp', data.token, env);
          if (token) {
            const props = token.props as McpIdentity;
            const client = await oauth.lookupClient(token.clientId);
            token.props = { ...props, clientName: client?.clientName || 'Connected app' };
            this.ctx.storage.sql.exec(
              'INSERT INTO oauth_activity VALUES(?,?) ON CONFLICT(id) DO UPDATE SET last_used=excluded.last_used',
              props.connectionId,
              Date.now(),
            );
          }
          return Response.json(token);
        }
        if (path === '/apps' || path === '/revoke' || path === '/revoke-all') {
          let cursor: string | undefined;
          const grants = [];
          do {
            const page = await oauth.listUserGrants(data.uid, { limit: 1000, cursor });
            grants.push(...page.items);
            cursor = page.cursor;
          } while (cursor);
          if (path === '/apps')
            return Response.json({
              apps: grants.map((g) => ({
                id: g.id,
                clientName: g.metadata?.clientName || 'Connected app',
                connectedAt: g.metadata?.connectedAt || g.createdAt * 1000,
                lastUsed:
                  [
                    ...this.ctx.storage.sql.exec<{ last_used: number }>(
                      'SELECT last_used FROM oauth_activity WHERE id=?',
                      String(g.metadata?.connectionId || ''),
                    ),
                  ][0]?.last_used || null,
                scope: g.scope,
              })),
            });
          const selected = path === '/revoke-all' ? grants : grants.filter((g) => g.id === data.id);
          if (path === '/revoke' && !selected.length)
            return Response.json({ error: 'Connected app not found' }, { status: 404 });
          for (const g of selected) {
            await oauth.revokeGrant(g.id, data.uid);
            this.ctx.storage.sql.exec(
              'DELETE FROM oauth_activity WHERE id=?',
              String(g.metadata?.connectionId || ''),
            );
          }
          return Response.json({ ok: true });
        }
        return Response.json({ error: 'Not found' }, { status: 404 });
      } catch (error) {
        if (error instanceof AuthorizationError)
          return Response.json({ error: error.description }, { status: 400 });
        if (error instanceof CimdFetchError)
          return Response.json({ error: 'This app could not be verified.' }, { status: 400 });
        // Contain transient provider failures rather than resetting the shared DO.
        console.log(JSON.stringify({ evt: 'oauth_error', ok: false }));
        return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
      }
    });
  }
}

export function oauthCall(env: Env, path: string, data: unknown): Promise<Response> {
  return env.OAUTH_STORAGE.get(env.OAUTH_STORAGE.idFromName('oauth')).fetch(
    'https://internal' + path,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

async function handleKey(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
