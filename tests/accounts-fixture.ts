import { vi } from 'vitest';
import type { AccountsService, AccountsIdentity, AccountsUser } from '../cloudflare/accounts';
/** Test-only RPC double; never bound by production Wrangler. */
export function fakeAccounts() {
 const profiles = new Map<string, AccountsUser>();
 const codes = new Map<string, string>();
 const emails = new Map<string, string>();
 const imports = new Map<string, string>();
 const identity = (email: string | null, sub?: string): AccountsIdentity => {
   sub ||= (email && emails.get(email)) || 'jl1_' + crypto.randomUUID().replaceAll('-', '');
   if (email) emails.set(email, sub);
   profiles.set(sub, profiles.get(sub) || { sub, email, hasGoogle: false, clients: ['incord'] });
   return { sub, email, isNew: false };
 };
 const service = {
  startEmail: vi.fn(async ({email}: {email:string;ip:string}) => { codes.set(email, '123456'); return {ok:true as const}; }),
  verifyEmail: vi.fn(async ({email,code}: {email:string;code:string;ip:string}) => { if (codes.get(email)!==code) return {error:'invalid_code'}; codes.delete(email); return {...identity(email),ssoTicket:'test-one-time-ticket'}; }),
  exchangeCode: vi.fn(async (_input: {code:string;codeVerifier:string;redirectUri:string}) => identity('person@example.com')),
  getUser: vi.fn(async ({sub}:{sub:string}) => profiles.get(sub) || null),
  deleteLink: vi.fn(async ({sub}:{sub:string}) => { profiles.delete(sub); return {deleted:'link' as const}; }),
  importIdentity: vi.fn(async ({googleSub}:{googleSub?:string;verifiedAt:number}) => { const sub=imports.get(googleSub!) || identity(null).sub; imports.set(googleSub!,sub); return {sub,isNew:false}; })
 } satisfies AccountsService;
 return {service,codes,profiles,identity};
}
