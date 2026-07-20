import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerGuardrailTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'list_guardrail_events',
    'List variants currently paused by the guardrail in the last 24 hours.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        guardrailEvents: Array<{
          componentId: string;
          variantIds: string[];
          pausedAt: string | null;
        }>;
      }>(`/projects/${id}/guardrail-events`);

      if (!data.guardrailEvents.length) {
        return { content: [{ type: 'text' as const, text: 'No active guardrail events in the last 24 hours.' }] };
      }

      const lines = data.guardrailEvents.map((e) =>
        `- ${e.componentId}: variants [${e.variantIds.join(', ')}] paused${e.pausedAt ? ` at ${e.pausedAt}` : ''}`
      );

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
