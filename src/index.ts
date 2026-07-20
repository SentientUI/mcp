import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { createMcpServer } from './server.js';
import { resolveDemoToken } from './demo.js';

async function main() {
  let apiKey = process.env.SENTIENTUI_API_KEY;

  if (!apiKey) {
    apiKey = await resolveDemoToken();
  }

  const client = new ApiClient({ apiKey, baseUrl: process.env.SENTIENTUI_API_URL });
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[sentientui-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
