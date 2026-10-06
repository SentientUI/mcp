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

  // A pk_ publishable key is the SDK's browser key, not a management credential.
  // It used to start the server happily and fail on the FIRST tool call with a
  // bare 401, so the agent blamed the tool (or the user's project) rather than
  // the config. Refuse it at startup, where the fix is one env var away.
  if (apiKey && /^pk_/i.test(apiKey)) {
    throw new Error(
      'SENTIENTUI_API_KEY is a pk_ publishable key — that key is for the browser SDK and cannot read or manage project data. ' +
        'Use the project\'s sk_ server key (Dashboard → Settings → API keys → Server key), or connect by URL (https://api.sentient-ui.com/mcp) and sign in.',
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
