import { afterEach, beforeEach, it, expect, vi } from 'vitest';
vi.mock('./store', () => ({ api: vi.fn() }));
import { api } from './store';
import { pushHealth, subscriptionHash } from './notifications';
const call = vi.mocked(api),
  endpoint = 'https://web.push.apple.com/private-device-token';
let permission = 'granted',
  subscription: any;
beforeEach(() => {
  call.mockReset();
  permission = 'granted';
  subscription = null;
  vi.stubGlobal('window', { Notification: {}, PushManager: {} });
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('compares only a SHA-256 hash and repairs a rotated subscription', async () => {
  subscription = { endpoint, toJSON: () => ({ endpoint, keys: { auth: 'private-key' } }) };
  call
    .mockResolvedValueOnce({ subscribed: false, results: [] })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ subscribed: true, results: [] });
  expect(await pushHealth(true)).toEqual({ state: 'on', results: [] });
  const status = '/push/status?endpointHash=' + (await subscriptionHash(endpoint));
  expect(call.mock.calls).toEqual([
    [status],
    ['/push/subscribe', { subscription: subscription.toJSON() }],
    [status],
  ]);
  expect(status).not.toContain('private-device-token');
});
it('distinguishes granted-without-subscription from denied without prompting', async () => {
  call.mockResolvedValue({ subscribed: false, results: [] });
  expect((await pushHealth(true)).state).toBe('missing');
  permission = 'denied';
  expect((await pushHealth(true)).state).toBe('denied');
  expect(call.mock.calls.every(([path]) => path === '/push/status')).toBe(true);
});
it('never registers a device subscription while signed out', async () => {
  subscription = { endpoint };
  expect((await pushHealth(false)).state).toBe('missing');
  expect(call).not.toHaveBeenCalled();
});
