import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiClient } from './api-client.js';

// Single source of truth for the advertised version: read it from package.json
// at runtime. `../package.json` resolves the same in dev (src/) and in the
// published package (dist/../package.json === the package root), so the handshake
// version can never drift from the released version again.
const { version: PKG_VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };
import { registerProjectTools } from './tools/projects.js';
import { registerComponentTools } from './tools/components.js';
import { registerInsightTools } from './tools/insights.js';
import { registerPersonaTools } from './tools/personas.js';
import { registerGoalTools } from './tools/goals.js';
import { registerGuardrailTools } from './tools/guardrails.js';
import { registerLayoutTools } from './tools/layout.js';
import { registerVariantWriteTools } from './tools/variants.js';
import { registerVariantBriefTools } from './tools/variant-brief.js';
import { registerTestBriefTools } from './tools/test-brief.js';
import { registerIntegrationGuideTools } from './tools/integration-guide.js';

export function createMcpServer(client: ApiClient): McpServer {
  const server = new McpServer({
    name: '@sentientui/mcp',
    version: PKG_VERSION,
  });

  registerProjectTools(server, client);
  registerComponentTools(server, client);
  registerInsightTools(server, client);
  registerPersonaTools(server, client);
  registerGoalTools(server, client);
  registerGuardrailTools(server, client);
  registerLayoutTools(server, client);
  registerVariantBriefTools(server, client);
  registerTestBriefTools(server, client);
  registerVariantWriteTools(server, client);
  registerIntegrationGuideTools(server);

  return server;
}
