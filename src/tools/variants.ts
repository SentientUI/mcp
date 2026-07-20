import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerVariantWriteTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'create_variant',
    'Create a NO-CODE managed text variant for a component (content stored in SentientUI, rendered by <AdaptiveText>). Use this ONLY for text-only variants the user wants without a code change. For variants that will live in the codebase (full components — copy, markup, styling), use get_variant_brief and write the variant in code instead; those auto-register on deploy and do not need create_variant. Requires a paid plan (server keys are Starter+; anonymous demo tokens are read-only).',
    {
      projectId: projectIdSchema,
      componentId: z.string().describe('The component ID to add a variant to'),
      displayName: z.string().describe('Human-readable name for the new variant'),
      content: z.string().optional().describe('The text content for this managed variant (rendered by <AdaptiveText>). Generate it from get_variant_brief context; omit only to create an empty placeholder to fill in from the dashboard.'),
    },
    async ({ projectId, componentId, displayName, content }) => {
      const id = encodeURIComponent(projectId);
      const result = await client.post<{ variantId: string; displayName: string }>(
        `/projects/${id}/variants`,
        { componentId, displayName, content },
      );
      const contentNote = content
        ? ' with the provided text content'
        : ' (empty — add its text content from the dashboard or via a follow-up update)';
      return {
        content: [{
          type: 'text' as const,
          text: `Managed text variant created: ${result.variantId} ("${result.displayName}") for component ${componentId}${contentNote}. It is in draft state — activate it from the dashboard. Reminder: this is a no-code managed variant; for code-native variants, edit the code instead (see get_variant_brief).`,
        }],
      };
    },
  );

  server.tool(
    'pause_variant',
    'Pause a variant, stopping traffic from being assigned to it.',
    {
      projectId: projectIdSchema,
      componentId: z.string().describe('The component ID'),
      variantId: z.string().describe('The variant ID to pause'),
    },
    async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/variants/pause`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${variantId} in component ${componentId} has been paused. No new traffic will be assigned to it.`,
        }],
      };
    },
  );

  server.tool(
    'refresh_insights',
    'Trigger fresh AI insight generation for a project. Returns immediately; use get_insights in ~15 seconds to see results.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/insights/refresh`);
      return {
        content: [{
          type: 'text' as const,
          text: `Insights are generating for project ${projectId}. Call get_insights in ~15 seconds to see the results.`,
        }],
      };
    },
  );
}
