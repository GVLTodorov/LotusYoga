import { vi } from 'vitest';
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from './client';
import { jsonResponse } from '../test/utils';

afterEach(() => vi.restoreAllMocks());

describe('api client', () => {
  it('sends bearer token, query string and parses JSON', async () => {
    setToken('tok');
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
    await api.sessions('2026-11-02', '2026-11-15');
    const [url, init] = f.mock.calls[0];
    expect(String(url).endsWith('/api/sessions?from=2026-11-02&to=2026-11-15')).toBe(true);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
  it('omits empty query values and sends no auth header when logged out', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse([]));
    await api.sessions();
    expect(String(f.mock.calls[0][0]).endsWith('/api/sessions')).toBe(true);
    expect((f.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it('turns error bodies into ApiError with code and details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ path: 'phone', message: 'req' }] } }, 400),
    );
    const e = await api.login({ email: 'a', password: 'b' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.details[0].path).toBe('phone');
  });
  it('handles 204 and network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => jsonResponse(null, 204));
    await expect(api.leaveWaitlist('w1')).resolves.toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('x'));
    await expect(api.myCards()).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('calls the unauthorized handler on 401 UNAUTHORIZED with a token', async () => {
    setToken('old');
    const h = vi.fn();
    setUnauthorizedHandler(h);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401));
    await api.me().catch(() => undefined);
    expect(h).toHaveBeenCalled();
    setUnauthorizedHandler(null);
    setToken(null);
    expect(getToken()).toBeNull();
  });
});
