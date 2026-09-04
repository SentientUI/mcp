import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { createMcpServer } from './server.js';
import { resolveDemoToken, refreshDemoToken } from './demo.js';

async function main() {
  const rawKey = process.env.SENTIENTUI_API_KEY;
  let apiKey = rawKey?.trim();
  let refreshApiKey: (() => Promise<string | null>) | undefined;

  // A key that is SET but empty/whitespace is a broken config (an env template,
  // a secret injection that came up empty), not a request for demo mode. Falling
  // through to the anonymous 10-call demo here made the real project silently
  // vanish behind a sandbox one. Only a genuinely UNSET variable means demo.
  if (rawKey !== undefined && !apiKey) {
    throw new Error(
      'SENTIENTUI_API_KEY is set but empty. Set it to a real server key (sk_…), or unset it entirely to use anonymous demo mode.',
    );
  }

  if (!apiKey) {
    apiKey = await resolveDemoToken();
    refreshApiKey = refreshDemoToken;
  }

  const client = new ApiClient({ apiKey, baseUrl: process.env.SENTIENTUI_API_URL, refreshApiKey });
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[sentientui-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
