import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerGuardrailTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'list_guardrail_events',
    {
      title: 'List guardrail events',
      description: 'List variants currently paused by the guardrail in the last 24 hours.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        events: z
          .array(
            z.object({
              componentId: z.string(),
              variantIds: z.array(z.string()).describe('Variants paused by the guardrail'),
              pausedAt: z.string().nullable().describe('ISO timestamp the pause fired, or null'),
            }),
          )
          .describe('Guardrail events in the last 24h (empty if none)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const data = await client.get<{
        guardrailEvents: Array<{
          componentId: string;
          variantIds: string[];
          pausedAt: string | null;
        }>;
      }>(`/projects/${id}/guardrail-events`);

      const structuredContent = {
        events: data.guardrailEvents.map((e) => ({
          componentId: e.componentId,
          variantIds: e.variantIds,
          pausedAt: e.pausedAt,
        })),
      };

      if (!data.guardrailEvents.length) {
        return {
          content: [{ type: 'text' as const, text: 'No active guardrail events in the last 24 hours.' }],
          structuredContent,
        };
      }

      const lines = data.guardrailEvents.map((e) =>
        `- ${e.componentId}: variants [${e.variantIds.join(', ')}] paused${e.pausedAt ? ` at ${e.pausedAt}` : ''}`
      );

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
    },
  );
}
