import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'sentientui');
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-anon.json');
const API_BASE = process.env.SENTIENTUI_API_URL ?? 'https://api.sentient-ui.com';

type AnonConfig = { token: string; projectId: string };

// Whether the token this process is running on came from the cache file (a
// fresh provision that 429s really is out of quota), and whether we already
// spent our single re-provision attempt (so an exhausted quota can never loop).
let tokenCameFromCache = false;
let refreshAttempted = false;

function readCachedToken(): AnonConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as AnonConfig;
  } catch {
    return null;
  }
}

function writeCachedToken(cfg: AnonConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

async function provisionToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/mcp/demo`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Demo provisioning failed: ${String(body.error ?? res.statusText)}`);
  }

  const data = await res.json() as { token: string; projectId: string; callsRemaining: number };
  writeCachedToken({ token: data.token, projectId: data.projectId });

  process.stderr.write(
    `[sentientui-mcp] Demo token provisioned (${data.callsRemaining} calls/month). Set SENTIENTUI_API_KEY to remove this limit.\n`,
  );

  return data.token;
}

export async function resolveDemoToken(): Promise<string> {
  const cached = readCachedToken();
  if (cached?.token) {
    tokenCameFromCache = true;
    process.stderr.write(
      `[sentientui-mcp] Running in demo mode (${CONFIG_FILE}). Set SENTIENTUI_API_KEY for full access.\n`,
    );
    return cached.token;
  }

  process.stderr.write('[sentientui-mcp] No API key found. Provisioning anonymous demo token...\n');
  return provisionToken();
}

/**
 * ApiClient calls this on 429 demo_quota_exceeded. A cached token whose
 * server-side row was deleted (quota table pruned, database reset) answers
 * that code on EVERY call — the client kept returning the cached token
 * unconditionally, so demo mode dead-ended forever with "quota exceeded"
 * for a user who had used nothing. Drop the cache and provision once.
 * Returns null (surface the original 429) when the running token was freshly
 * provisioned, when the one refresh was already spent, or when provisioning
 * itself fails.
 */
export async function refreshDemoToken(): Promise<string | null> {
  if (!tokenCameFromCache || refreshAttempted) return null;
  refreshAttempted = true;
  try {
    rmSync(CONFIG_FILE, { force: true });
  } catch {
    // Cache already gone — provisioning below still writes a fresh one.
  }
  process.stderr.write(
    '[sentientui-mcp] Cached demo token was rejected by the server; provisioning a fresh one...\n',
  );
  try {
    return await provisionToken();
  } catch {
    return null;
  }
}
