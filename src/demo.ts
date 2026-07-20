import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'sentientui');
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-anon.json');
const API_BASE = process.env.SENTIENTUI_API_URL ?? 'https://api.sentient-ui.com';

type AnonConfig = { token: string; projectId: string };

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

export async function resolveDemoToken(): Promise<string> {
  const cached = readCachedToken();
  if (cached?.token) {
    process.stderr.write(
      `[sentientui-mcp] Running in demo mode (${CONFIG_FILE}). Set SENTIENTUI_API_KEY for full access.\n`,
    );
    return cached.token;
  }

  process.stderr.write('[sentientui-mcp] No API key found. Provisioning anonymous demo token...\n');

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
