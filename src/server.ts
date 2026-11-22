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
import { registerStageTools } from './tools/stages.js';
import { registerKnownPeopleTools } from './tools/known-people.js';
import { registerMainFunnelTools } from './tools/main-funnel.js';
import { registerPageGroupTools } from './tools/page-groups.js';
import { registerTestTools } from './tools/tests.js';
import { registerPageElementTools } from './tools/page-elements.js';
import { registerNeedsYouTools } from './tools/needs-you.js';
import { registerGoalTools } from './tools/goals.js';
import { registerFunnelTools } from './tools/funnels.js';
import { registerGuardrailTools } from './tools/guardrails.js';
import { registerLayoutTools } from './tools/layout.js';
import { registerVariantWriteTools } from './tools/variants.js';
import { registerVariantBriefTools } from './tools/variant-brief.js';
import { registerTestBriefTools } from './tools/test-brief.js';
import { registerIntegrationGuideTools } from './tools/integration-guide.js';
import { registerAgentTrafficTools } from './tools/agent-traffic.js';
import { registerTrafficTools } from './tools/traffic.js';
import { registerInternalTrafficTools } from './tools/internal-traffic.js';
import { registerSiteAreasTools } from './tools/site-areas.js';
import { registerCellTools } from './tools/cells.js';
import { registerAgentReadTools } from './tools/agent-reads.js';
import { registerManageTools } from './tools/manage.js';
import { registerUiResources, RESOURCE_MIME_TYPE } from './ui/index.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';

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
      // Sent in the initialize result: the facts an agent otherwise gets
      // wrong (which audiences serve, clusters are not personas, hybrids need
      // Migrate, the server goal call shape). See instructions.ts.
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // MCP Apps: register the ui:// resources the data-viz tools link to via _meta.
  registerUiResources(server);

  registerProjectTools(server, client);
  registerComponentTools(server, client);
  registerInsightTools(server, client);
  registerPersonaTools(server, client);
  registerStageTools(server, client);
  registerKnownPeopleTools(server, client);
  registerMainFunnelTools(server, client);
  registerPageGroupTools(server, client);
  registerTestTools(server, client);
  registerPageElementTools(server, client);
  registerNeedsYouTools(server, client);
  registerGoalTools(server, client);
  registerFunnelTools(server, client);
  registerGuardrailTools(server, client);
  registerLayoutTools(server, client);
  registerVariantBriefTools(server, client);
  registerTestBriefTools(server, client);
  registerVariantWriteTools(server, client);
  registerIntegrationGuideTools(server);
  registerAgentTrafficTools(server, client);
  registerTrafficTools(server, client);
  registerInternalTrafficTools(server, client);
  registerSiteAreasTools(server, client);
  registerCellTools(server, client);
  registerAgentReadTools(server, client);
  registerManageTools(server, client);

  return server;
}
