import { Env, ObjectData } from './types';

export const encoder = new TextEncoder();

export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assert(ok: unknown, message = 'Invalid request', status = 400): asserts ok {
  if (!ok) throw new ApiError(status, message);
}

export function b64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function unb64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

export const random = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));

export async function digest(value: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))));
}

export function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function body(request: Request, maxBytes = 2_000_000): Promise<ObjectData> {
  assert(
    !request.headers.get('Content-Length') ||
      Number(request.headers.get('Content-Length')) <= maxBytes,
    'Request too large',
    413,
  );
  assert(
    request.headers.get('Content-Type')?.includes('application/json'),
    'Expected application/json',
    415,
  );
  // Stream cap also covers chunked requests without Content-Length.
  const reader = request.body?.getReader();
  assert(reader, 'Missing body');
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'Request too large');
    }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  let result: unknown;
  try {
    result = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'Invalid JSON');
  }
  assert(result && typeof result === 'object' && !Array.isArray(result));
  return result as ObjectData;
}

export function stub(env: Env, uid: string) {
  return env.USERS.get(env.USERS.idFromName(uid));
}

export async function call(target: DurableObjectStub, path: string, data: unknown = {}) {
  const response = await target.fetch('https://internal' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const problem = await response.json<{ error: string }>();
    throw new ApiError(response.status, problem.error);
  }
  return response.json<any>();
}

export const registry = (env: Env, path: string, data: unknown = {}) =>
  call(env.REGISTRY.get(env.REGISTRY.idFromName('registry')), path, data);

export const user = (env: Env, uid: string, path: string, data: unknown = {}) =>
  call(stub(env, uid), path, data);
