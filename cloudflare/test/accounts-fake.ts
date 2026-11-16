/** TEST ONLY. Never bind this entrypoint in a deployed configuration. */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { AccountsService } from '../accounts';
type User = { sub: string; email: string | null; hasGoogle: boolean; clients: string[] };
const users = new Map<string, User>(),
  emails = new Map<string, string>(),
  google = new Map<string, string>();
const codes = new Map<string, { code: string; expires: number }>(),
  tickets = new Map<string, { sub: string; expires: number }>();
const grants = new Map<
  string,
  { sub: string; challenge: string; redirectUri: string; expires: number }
>();
const normalize = (email: string) => email.trim().toLowerCase();
const token = () => crypto.randomUUID();
function identity(email: string | null, googleSub?: string) {
  const existing = (googleSub && google.get(googleSub)) || (email && emails.get(email));
  const sub = existing || 'jl1_' + token().replaceAll('-', '');
  if (!existing) users.set(sub, { sub, email, hasGoogle: !!googleSub, clients: ['incord'] });
  if (email) emails.set(email, sub);
  if (googleSub) {
    google.set(googleSub, sub);
    users.get(sub)!.hasGoogle = true;
  }
  return { sub, email: users.get(sub)!.email, isNew: !existing };
}
async function challenge(verifier: string) {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export class IncordClient extends WorkerEntrypoint implements AccountsService {
  async startEmail(input: {
    email: string;
    ip: string;
  }): ReturnType<AccountsService['startEmail']> {
    const email = normalize(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_email' };
    codes.set(email, {
      code: String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'),
      expires: Date.now() + 600000,
    });
    return { ok: true };
  }
  async verifyEmail(input: {
    email: string;
    code: string;
    ip: string;
  }): ReturnType<AccountsService['verifyEmail']> {
    const email = normalize(input.email),
      record = codes.get(email);
    if (!record || record.code !== input.code) return { error: 'invalid_code' };
    codes.delete(email);
    if (record.expires < Date.now()) return { error: 'expired' };
    const result = identity(email),
      ssoTicket = token();
    tickets.set(ssoTicket, { sub: result.sub, expires: Date.now() + 60000 });
    return { ...result, ssoTicket };
  }
  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): ReturnType<AccountsService['exchangeCode']> {
    const grant = grants.get(input.code);
    grants.delete(input.code);
    if (
      !grant ||
      grant.expires < Date.now() ||
      grant.redirectUri !== input.redirectUri ||
      grant.challenge !== (await challenge(input.codeVerifier))
    )
      return { error: 'invalid_grant' };
    const user = users.get(grant.sub)!;
    return { sub: user.sub, email: user.email, isNew: false };
  }
  async getUser(input: { sub: string }): ReturnType<AccountsService['getUser']> {
    return users.get(input.sub) || null;
  }
  async deleteLink(input: { sub: string }): ReturnType<AccountsService['deleteLink']> {
    const user = users.get(input.sub);
    if (!user) return { deleted: 'none' };
    users.delete(input.sub);
    if (user.email) emails.delete(user.email);
    for (const [id, sub] of google) if (sub === input.sub) google.delete(id);
    return { deleted: 'user' };
  }
  async importIdentity(input: {
    email?: string;
    googleSub?: string;
    verifiedAt: number;
  }): ReturnType<AccountsService['importIdentity']> {
    if (
      (!input.email && !input.googleSub) ||
      !Number.isFinite(input.verifiedAt) ||
      input.verifiedAt <= 0 ||
      input.verifiedAt > Date.now()
    )
      return { error: 'invalid_identity' };
    const email = input.email ? normalize(input.email) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_identity' };
    const prior = email && emails.get(email);
    if (
      prior &&
      input.googleSub &&
      users.get(prior)?.hasGoogle &&
      google.get(input.googleSub) !== prior
    )
      return { error: 'invalid_identity' };
    const result = identity(email, input.googleSub);
    return { sub: result.sub, isNew: result.isNew };
  }
  async fetch(request: Request) {
    return handle(request);
  }
}
async function handle(request: Request) {
  const url = new URL(request.url),
    p = url.searchParams;
  if (url.pathname === '/health') return Response.json({ testOnly: true });
  if (url.pathname === '/__test/last-code')
    return Response.json({ code: codes.get(normalize(p.get('email') || ''))?.code || null });
  if (url.pathname === '/authorize') {
    const redirect = p.get('redirect_uri') || '';
    if (
      p.get('client') !== 'incord' ||
      !/^https?:\/\/localhost:\d+\/auth\/jesklabs\/callback$/.test(redirect) ||
      !p.get('state') ||
      p.get('code_challenge_method') !== 'S256' ||
      !p.get('code_challenge')
    )
      return new Response('Invalid authorize request', { status: 400 });
    const callback = new URL(redirect);
    callback.searchParams.set('state', p.get('state')!);
    if (p.get('prompt') === 'none' && p.get('__test_sso') === 'none')
      callback.searchParams.set('error', 'login_required');
    else {
      const email = p.get('__test_email') || 'browser-sso@example.com',
        user = identity(email, p.get('provider') === 'google' ? 'google:' + email : undefined),
        code = token();
      grants.set(code, {
        sub: user.sub,
        challenge: p.get('code_challenge')!,
        redirectUri: redirect,
        expires: Date.now() + 60000,
      });
      callback.searchParams.set('code', code);
    }
    return Response.redirect(callback.href, 302);
  }
  if (url.pathname === '/sso/attach') {
    const ticket = tickets.get(p.get('ticket') || '');
    tickets.delete(p.get('ticket') || '');
    if (!ticket || ticket.expires < Date.now() || p.get('client') !== 'incord')
      return new Response('Invalid ticket', { status: 400 });
    const back = p.get('return') || '/';
    if (!back.startsWith('/') || back.startsWith('//'))
      return new Response('Invalid return', { status: 400 });
    return Response.json({ returnPath: back }); // Browser harness supplies the local registered origin.
  }
  return new Response('Not found', { status: 404 });
}
export default { fetch: handle };
