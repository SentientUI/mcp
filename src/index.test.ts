import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  ApiClient: vi.fn(),
  connect: vi.fn(),
  resolveDemoToken: vi.fn(),
  refreshDemoToken: vi.fn(),
}));

// index.ts runs main() at import time and connects a stdio transport; stub the
// whole startup surface so these tests exercise ONLY the key-resolution logic,
// with no network and no real server.
vi.mock('./api-client.js', () => ({ ApiClient: mocks.ApiClient }));
vi.mock('./server.js', () => ({ createMcpServer: vi.fn(() => ({ connect: mocks.connect })) }));
vi.mock('./demo.js', () => ({
  resolveDemoToken: mocks.resolveDemoToken,
  refreshDemoToken: mocks.refreshDemoToken,
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: vi.fn() }));

const originalKey = process.env.SENTIENTUI_API_KEY;
let exitSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

async function importIndex(): Promise<void> {
  vi.resetModules();
  await import('./index.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.resolveDemoToken.mockResolvedValue('demo_tok');
  delete process.env.SENTIENTUI_API_KEY;
  // main() reports fatal errors via stderr + process.exit(1); intercept both
  // so a (correctly) failing startup can be asserted instead of killing vitest.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never) as never;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.SENTIENTUI_API_KEY;
  else process.env.SENTIENTUI_API_KEY = originalKey;
});

describe('SENTIENTUI_API_KEY resolution', () => {
  it('unset → anonymous demo path with the demo refresher wired in', async () => {
    await importIndex();
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());

    expect(mocks.resolveDemoToken).toHaveBeenCalledTimes(1);
    expect(mocks.ApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'demo_tok', refreshApiKey: mocks.refreshDemoToken }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('set but EMPTY → fatal error, never the demo fallback', async () => {
    // The documented fix: an env template or a secret injection that came up
    // empty is a broken config. Falling through to the anonymous 10-call demo
    // made the real project silently vanish behind a sandbox one.
    process.env.SENTIENTUI_API_KEY = '';
    await importIndex();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('set but empty');
    expect(mocks.resolveDemoToken).not.toHaveBeenCalled();
    expect(mocks.ApiClient).not.toHaveBeenCalled();
  });

  it('set but whitespace-only → same fatal error (trim must not create demo mode)', async () => {
    // The rawKey !== undefined vs !apiKey distinction is exactly what a
    // refactor collapses into a single falsy check — whitespace is the case
    // that catches it, because trim() makes the key falsy while the variable
    // is very much set.
    process.env.SENTIENTUI_API_KEY = '   ';
    await importIndex();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    expect(mocks.resolveDemoToken).not.toHaveBeenCalled();
    expect(mocks.ApiClient).not.toHaveBeenCalled();
  });

  it('set to a real key → real path: trimmed key, no demo, no refresher', async () => {
    process.env.SENTIENTUI_API_KEY = '  sk_live_abc  ';
    await importIndex();
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());

    expect(mocks.resolveDemoToken).not.toHaveBeenCalled();
    expect(mocks.ApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk_live_abc', refreshApiKey: undefined }),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
