import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  fakeHome: '',
  rmSyncThrows: false,
}));

// demo.ts computes its cache path from homedir() at module load; point it at a
// per-test temp dir so tests exercise the REAL file cache (including the
// 0o700/0o600 modes) without touching the developer's ~/.config.
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: () => mocks.fakeHome };
});

// Delegate to real fs except for a switchable rmSync failure (see the
// "tolerates rmSync failure" test) — a full fs mock would stop the cache-file
// round-trip from being tested for real.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      if (mocks.rmSyncThrows) throw new Error('EACCES: permission denied');
      return fs.rmSync(...args);
    },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const cacheDir = () => join(mocks.fakeHome, '.config', 'sentientui');
const cacheFile = () => join(cacheDir(), 'mcp-anon.json');

function provisionOk(token: string) {
  return { ok: true, json: async () => ({ token, projectId: 'proj_1', callsRemaining: 10 }) };
}

function seedCache(token: string): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify({ token, projectId: 'proj_1' }));
}

// The tokenCameFromCache/refreshAttempted latches are module state, so every
// test re-imports a fresh copy of demo.ts.
async function importDemo() {
  vi.resetModules();
  return import('./demo.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rmSyncThrows = false;
  mocks.fakeHome = mkdtempSync(join(tmpdir(), 'snt-mcp-demo-'));
  // Silence the informational stderr lines; tests assert behaviour, not copy.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(mocks.fakeHome, { recursive: true, force: true });
});

describe('resolveDemoToken', () => {
  it('provisions when no cache exists and persists the token to disk', async () => {
    mockFetch.mockResolvedValue(provisionOk('demo_new'));
    const { resolveDemoToken } = await importDemo();

    await expect(resolveDemoToken()).resolves.toBe('demo_new');
    expect(JSON.parse(readFileSync(cacheFile(), 'utf-8'))).toEqual({ token: 'demo_new', projectId: 'proj_1' });
    // The cache holds a bearer credential: dir/file must not be group/world
    // readable, or any local user can hijack the anonymous project.
    if (process.platform !== 'win32') {
      expect(statSync(cacheDir()).mode & 0o777).toBe(0o700);
      expect(statSync(cacheFile()).mode & 0o777).toBe(0o600);
    }
  });

  it('returns the cached token without hitting the network', async () => {
    seedCache('demo_cached');
    const { resolveDemoToken } = await importDemo();

    await expect(resolveDemoToken()).resolves.toBe('demo_cached');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-provisions instead of throwing on a corrupt cache file', async () => {
    // A truncated write / hand-edited file must not brick the MCP server at
    // startup — unparseable cache means "no cache", not a crash.
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cacheFile(), '{not json!!');
    mockFetch.mockResolvedValue(provisionOk('demo_fresh'));
    const { resolveDemoToken } = await importDemo();

    await expect(resolveDemoToken()).resolves.toBe('demo_fresh');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('treats a cache entry without a token as absent', async () => {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify({ projectId: 'proj_1' }));
    mockFetch.mockResolvedValue(provisionOk('demo_fresh'));
    const { resolveDemoToken } = await importDemo();

    await expect(resolveDemoToken()).resolves.toBe('demo_fresh');
  });
});

describe('refreshDemoToken', () => {
  it('declines (null) when the running token was freshly provisioned', async () => {
    // A token provisioned by THIS process that immediately 429s really is out
    // of quota — re-provisioning would loop against the rate limiter.
    mockFetch.mockResolvedValue(provisionOk('demo_new'));
    const demo = await importDemo();
    await demo.resolveDemoToken();

    await expect(demo.refreshDemoToken()).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1); // the original provision only
  });

  it('drops a rejected CACHED token and provisions a replacement once', async () => {
    // The production bug: a cached token whose server-side row was pruned
    // answered demo_quota_exceeded on every call, and the client resent it
    // unconditionally — demo mode dead-ended forever for an unused quota.
    seedCache('demo_stale');
    mockFetch.mockResolvedValue(provisionOk('demo_fresh'));
    const demo = await importDemo();
    await demo.resolveDemoToken();

    await expect(demo.refreshDemoToken()).resolves.toBe('demo_fresh');
    // The dead token is gone from disk — the next process starts clean too.
    expect(JSON.parse(readFileSync(cacheFile(), 'utf-8')).token).toBe('demo_fresh');
  });

  it('the latch: a second call after a refusal must NOT re-provision', async () => {
    // If refreshAttempted failed to latch, every subsequent 429 would trigger
    // another provisioning POST — an infinite provisioning loop against a
    // genuinely exhausted (or refusing) server.
    seedCache('demo_stale');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'anon_quota' }),
    });
    const demo = await importDemo();
    await demo.resolveDemoToken();

    await expect(demo.refreshDemoToken()).resolves.toBeNull();
    const callsAfterFirstRefresh = mockFetch.mock.calls.length;

    mockFetch.mockResolvedValue(provisionOk('demo_should_never_exist'));
    await expect(demo.refreshDemoToken()).resolves.toBeNull();
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirstRefresh);
  });

  it('returns null (never throws) when provisioning itself throws', async () => {
    // refreshDemoToken is called from the 429 recovery path; a throw here
    // would replace an actionable quota error with a crash.
    seedCache('demo_stale');
    mockFetch.mockRejectedValue(new Error('network down'));
    const demo = await importDemo();
    await demo.resolveDemoToken();

    await expect(demo.refreshDemoToken()).resolves.toBeNull();
  });

  it('tolerates an rmSync failure and still provisions the fresh token', async () => {
    // Deleting the stale cache is best-effort: a permissions hiccup on the
    // cache file must not abort the recovery that makes demo mode usable again.
    seedCache('demo_stale');
    mockFetch.mockResolvedValue(provisionOk('demo_fresh'));
    const demo = await importDemo();
    await demo.resolveDemoToken();

    mocks.rmSyncThrows = true;
    await expect(demo.refreshDemoToken()).resolves.toBe('demo_fresh');
    mocks.rmSyncThrows = false;
    // provisionToken overwrote the cache even though the delete failed.
    expect(JSON.parse(readFileSync(cacheFile(), 'utf-8')).token).toBe('demo_fresh');
  });
});
