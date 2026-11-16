/** Jesklabs Accounts v1. Only the named IncordClient binding may be used. */
export type AccountsFailure = { error: string; retryAfter?: number };
export type AccountsIdentity = { sub: string; email: string | null; isNew: boolean };
export type AccountsUser = {
  sub: string;
  email: string | null;
  hasGoogle: boolean;
  clients: string[];
};
type Result<T> = T | AccountsFailure;
export interface AccountsService {
  startEmail(input: { email: string; ip: string }): Promise<Result<{ ok: true }>>;
  verifyEmail(input: {
    email: string;
    code: string;
    ip: string;
  }): Promise<Result<AccountsIdentity & { ssoTicket: string }>>;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Result<AccountsIdentity>>;
  getUser(input: { sub: string }): Promise<Result<AccountsUser | null>>;
  deleteLink(input: { sub: string }): Promise<Result<{ deleted: 'link' | 'user' | 'none' }>>;
  importIdentity(input: {
    email?: string;
    googleSub?: string;
    verifiedAt: number;
  }): Promise<Result<{ sub: string; isNew: boolean }>>;
}
export class AccountsError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function accountsError(value: AccountsFailure): AccountsError {
  switch (value.error) {
    case 'rate_limited':
      return new AccountsError(
        429,
        'Please wait a little before trying again.',
        Number.isFinite(value.retryAfter) && value.retryAfter! > 0
          ? Math.ceil(value.retryAfter!)
          : undefined,
      );
    case 'invalid_email':
      return new AccountsError(400, 'Enter a valid email address.');
    case 'invalid_code':
      return new AccountsError(401, 'That code is invalid. Check it or request a new code.');
    case 'expired':
      return new AccountsError(401, 'That code has expired. Request a new code.');
    case 'invalid_grant':
      return new AccountsError(401, 'Sign-in expired. Please start again.');
    case 'invalid_identity':
      return new AccountsError(
        409,
        'That identity could not be linked. Please try another sign-in method.',
      );
    default:
      return new AccountsError(
        503,
        'Sign-in is temporarily unavailable. Please try again shortly.',
      );
  }
}
export async function accountsCall<K extends keyof AccountsService>(
  service: AccountsService | undefined,
  method: K,
  input: Parameters<AccountsService[K]>[0],
): Promise<Exclude<Awaited<ReturnType<AccountsService[K]>>, AccountsFailure>> {
  let result: Awaited<ReturnType<AccountsService[K]>>;
  try {
    if (!service) throw new Error();
    result = await (
      service[method] as (
        input: Parameters<AccountsService[K]>[0],
      ) => ReturnType<AccountsService[K]>
    )(input);
  } catch {
    throw accountsError({ error: 'temporarily_unavailable' });
  }
  if (result && 'error' in result) throw accountsError(result);
  return result as Exclude<typeof result, AccountsFailure>;
}
export function accountsReturnPath(
  value: string | null,
  origin = 'https://return.invalid',
): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return '/';
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}
export function maskedEmail(email: string | null): string {
  if (!email) return 'your Jesklabs account';
  const [local, domain] = email.split('@');
  return local.slice(0, 1) + '•••@' + domain;
}
