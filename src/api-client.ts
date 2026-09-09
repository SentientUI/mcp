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
  private refreshApiKey?: () => Promise<string | null>;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    /**
     * Called when the server answers 429 demo_quota_exceeded — the demo path's
     * chance to swap in a fresh token (see demo.ts). Returns the new key, or
     * null to give up and surface the original error.
     */
    refreshApiKey?: () => Promise<string | null>;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.sentient-ui.com').replace(/\/$/, '');
    this.refreshApiKey = opts.refreshApiKey;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
    // content-type only when a body is actually sent: Fastify 400s a bodyless
    // POST that declares application/json (FST_ERR_CTP_EMPTY_JSON_BODY), which
    // made refresh_insights — the one bodyless POST here — fail as a bare
    // "Bad Request" before its route ever ran.
    const res = await fetch(`${this.baseUrl}/v1/mgmt${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json() as Promise<T>;

    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // A cached demo token whose server-side row was lost answers 429
    // demo_quota_exceeded on every call, forever — the client kept resending
    // the dead token and the user was told they were out of quota when they
    // had used nothing. Swap in a fresh token once and retry this request;
    // `isRetry` (plus demo.ts's own one-shot guard) prevents a genuinely
    // exhausted quota from looping provisioning.
    if (res.status === 429 && errBody.error === 'demo_quota_exceeded' && this.refreshApiKey && !isRetry) {
      const fresh = await this.refreshApiKey();
      if (fresh) {
        this.apiKey = fresh;
        return this.request<T>(method, path, body, true);
      }
    }

    // body.error is the machine code apiErrorGuidance matches on; body.message
    // is the server's human sentence. Reading only body.error made endpoints
    // that send message alone (or message with details) surface as a bare
    // statusText — falling back keeps the code exact-matchable when present
    // and the message visible when it is all there is.
    throw new ApiError(res.status, String(errBody.error ?? errBody.message ?? res.statusText));
  }
}
