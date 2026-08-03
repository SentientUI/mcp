import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiClient } from './api-client.js';

// Single source of truth for the advertised version: tsup inlines the
// package.json version at build time via a `define` (see tsup.config.ts), so the
// handshake version can never drift from the released version again. This avoids
// reading it at runtime through `import.meta.url` — tsup's shim mangles
// import.meta in the split ESM build, producing `createRequire(undefined)` and
// crashing on boot. `typeof` guard keeps `tsx src/index.ts` (dev) working where
// the define isn't applied.
declare const __PKG_VERSION__: string;
const PKG_VERSION = typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : '0.0.0-dev';
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
import { registerAgentTrafficTools } from './tools/agent-traffic.js';
import { registerUiResources, RESOURCE_MIME_TYPE } from './ui/index.js';

export function createMcpServer(client: ApiClient): McpServer {
  const server = new McpServer(
    {
      name: '@sentientui/mcp',
      version: PKG_VERSION,
    },
    {
      // MCP Apps (SEP-1865): advertise the `io.modelcontextprotocol/ui` extension
      // in the initialize handshake so UI-capable hosts and agent-readiness
      // scanners negotiate it. Merged with the tools/resources capabilities the
      // SDK adds as they're registered below.
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      },
    },
  );

  // MCP Apps: register the ui:// resources the data-viz tools link to via _meta.
  registerUiResources(server);

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
  registerAgentTrafficTools(server, client);

  return server;
}
