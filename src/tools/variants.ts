import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

export function registerVariantWriteTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'create_variant',
    {
      title: 'Create managed variant',
      description: 'Create a NO-CODE managed text variant for a component (content stored in SentientUI, rendered by <AdaptiveText>). Use this ONLY for text-only variants the user wants without a code change. For variants that will live in the codebase (full components — copy, markup, styling), use get_variant_brief and write the variant in code instead; those auto-register on deploy and do not need create_variant. Requires a paid plan (server keys are Starter+; anonymous demo tokens are read-only).',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().describe('The component ID to add a variant to'),
        displayName: z.string().describe('Human-readable name for the new variant'),
        content: z.string().optional().describe('The text content for this managed variant (rendered by <AdaptiveText>). Generate it from get_variant_brief context; omit only to create an empty placeholder to fill in from the dashboard.'),
      },
      outputSchema: {
        variantId: z.string().describe('The new variant ID'),
        displayName: z.string(),
        componentId: z.string(),
        state: z.literal('draft').describe('New managed variants start in draft state'),
        hasContent: z.boolean().describe('Whether text content was provided at creation'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        structuredContent: {
          variantId: result.variantId,
          displayName: result.displayName,
          componentId,
          state: 'draft' as const,
          hasContent: Boolean(content),
        },
      };
    },
  );

  server.registerTool(
    'pause_variant',
    {
      title: 'Pause variant',
      description: 'Pause a variant, stopping traffic from being assigned to it.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().describe('The component ID'),
        variantId: z.string().describe('The variant ID to pause'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        paused: z.literal(true).describe('The variant is now paused'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/variants/pause`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${variantId} in component ${componentId} has been paused. No new traffic will be assigned to it.`,
        }],
        structuredContent: { variantId, componentId, paused: true as const },
      };
    },
  );

  server.registerTool(
    'refresh_insights',
    {
      title: 'Refresh insights',
      description: 'Trigger fresh AI insight generation for a project. Returns immediately; use get_insights in ~15 seconds to see results.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        projectId: z.string(),
        status: z.literal('generating').describe('Generation has been triggered'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/insights/refresh`);
      return {
        content: [{
          type: 'text' as const,
          text: `Insights are generating for project ${projectId}. Call get_insights in ~15 seconds to see the results.`,
        }],
        structuredContent: { projectId, status: 'generating' as const },
      };
    },
  );
}
