import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { ApiClient } from './api-client.js';

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ApiClient({ apiKey: 'sk_test_key', baseUrl: 'https://api.example.com' });
  });

  it('sends Bearer auth header on every request', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    await client.get('/projects');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/mgmt/projects',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer sk_test_key' }),
      }),
    );
  });

  it('throws ApiError with status when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    });
    await expect(client.get('/projects/bad-id/health')).rejects.toMatchObject({
      status: 404,
      message: 'not_found',
    });
  });

  it('sends POST body as JSON', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await client.post('/projects/abc/variants', { componentId: 'hero', displayName: 'V2' });
    const call = mockFetch.mock.calls[0]!;
    expect(call[1]?.body).toBe(JSON.stringify({ componentId: 'hero', displayName: 'V2' }));
  });

  // body.error used to be the ONLY field read; endpoints that send message
  // alone surfaced as a bare statusText and the actionable sentence was lost.
  it('falls back to body.message when body.error is absent', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Anonymous demo is limited to 10 calls/month.' }),
    });
    await expect(client.get('/projects')).rejects.toMatchObject({
      status: 429,
      message: 'Anonymous demo is limited to 10 calls/month.',
    });
  });

  it('keeps body.error as the exact-matchable code when both fields are present', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'demo_quota_exceeded', message: 'Set SENTIENTUI_API_KEY to continue.' }),
    });
    await expect(client.get('/projects')).rejects.toMatchObject({ message: 'demo_quota_exceeded' });
  });

  describe('demo-token refresh on 429 demo_quota_exceeded', () => {
    // A cached demo token whose server-side row was lost answered
    // demo_quota_exceeded on every call, forever — the dead token was resent
    // unconditionally, so demo mode dead-ended for a user who had used nothing.
    it('swaps in a fresh key once and retries the request', async () => {
      const refreshApiKey = vi.fn().mockResolvedValue('demo_fresh');
      const c = new ApiClient({ apiKey: 'demo_stale', baseUrl: 'https://api.example.com', refreshApiKey });
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'demo_quota_exceeded' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ fine: true }) });
      await expect(c.get('/projects')).resolves.toEqual({ fine: true });
      expect(refreshApiKey).toHaveBeenCalledTimes(1);
      // The retry carries the FRESH token, not the dead one.
      expect(mockFetch.mock.calls[1]![1]?.headers?.authorization).toBe('Bearer demo_fresh');
    });

    it('retries at most once — a genuinely exhausted quota surfaces the 429', async () => {
      const refreshApiKey = vi.fn().mockResolvedValue('demo_fresh');
      const c = new ApiClient({ apiKey: 'demo_stale', baseUrl: 'https://api.example.com', refreshApiKey });
      mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'demo_quota_exceeded' }) });
      await expect(c.get('/projects')).rejects.toMatchObject({ status: 429, message: 'demo_quota_exceeded' });
      expect(refreshApiKey).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('surfaces the original 429 when the refresher declines (returns null)', async () => {
      const refreshApiKey = vi.fn().mockResolvedValue(null);
      const c = new ApiClient({ apiKey: 'demo_fresh', baseUrl: 'https://api.example.com', refreshApiKey });
      mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'demo_quota_exceeded' }) });
      await expect(c.get('/projects')).rejects.toMatchObject({ message: 'demo_quota_exceeded' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
