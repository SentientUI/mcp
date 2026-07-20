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
});
