export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.sentient-ui.com').replace(/\/$/, '');
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1/mgmt${path}`, {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new ApiError(res.status, String(body.error ?? res.statusText));
    }
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1/mgmt${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new ApiError(res.status, String(errBody.error ?? res.statusText));
    }
    return res.json() as Promise<T>;
  }
}
