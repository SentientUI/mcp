import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, withApiErrorGuidance, type ExtraGuidance } from './common.js';

// Create-specific codes the shared mapper doesn't know. Auth-mode refusals
// (insufficient_scope / demo_read_only / insufficient_role) intentionally fall
// through to the shared apiErrorGuidance wording — ONE guidance source, no fork.
const CREATE_PROJECT_GUIDANCE: ExtraGuidance = {
  project_limit_reached:
    "You've reached your plan's project limit. Upgrade your plan or remove an existing project, then try again.",
  name_required: 'A project name is required to create a project.',
};

export function registerProjectTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a NEW SentientUI project (onboarding). Returns the project id and its pk_ public key for the SDK. Requires an account login: this works when connected via OAuth (the hosted MCP URL) but NOT with a project-scoped sk_ server key or an anonymous demo token. After it succeeds, call get_integration_guide and help the user install @sentientui/react with the returned key.',
      inputSchema: {
        name: z.string().min(1).describe('Human-readable project name'),
        contextType: z
          .enum(['saas', 'ecommerce', 'marketing', 'landing', 'internal'])
          .optional()
          .describe('What kind of product this is; defaults to saas'),
        framework: z
          .enum(['next', 'react', 'core'])
          .optional()
          .describe('How the site is built — next, react, or core (website builder/CMS); defaults to next'),
        websiteUrl: z
          .string()
          .optional()
          .describe("Production site origin to allow-list so the SDK's events aren't origin-blocked on day one"),
      },
      outputSchema: {
        projectId: z.string().describe('The new project UUID'),
        publicKey: z.string().describe('The pk_ public key to configure the SDK with'),
        name: z.string().describe('The project name'),
        contextType: z.string().describe('The resolved context type'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ name, contextType, framework, websiteUrl }) => {
      const created = await client.post<{ id: string; apiKey: string }>('/projects', {
        name,
        contextType,
        framework,
        origin: websiteUrl,
      });
      const resolvedContextType = contextType ?? 'saas';
      return {
        content: [{
          type: 'text' as const,
          text: [
            `Created project "${name}" (id: ${created.id}, type: ${resolvedContextType}).`,
            `Public key: ${created.apiKey}`,
            `Next: install @sentientui/react with this key. Ask me to pull the setup guide (get_integration_guide) and I'll wrap your first component.`,
          ].join('\n'),
        }],
        structuredContent: {
          projectId: created.id,
          publicKey: created.apiKey,
          name,
          contextType: resolvedContextType,
        },
      };
    }, CREATE_PROJECT_GUIDANCE),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List all SentientUI projects for the authenticated account.',
      inputSchema: {},
      outputSchema: {
        projects: z
          .array(
            z.object({
              id: z.string().describe('Project UUID'),
              name: z.string(),
              contextType: z.string(),
              createdAt: z.string().describe('ISO date (YYYY-MM-DD)'),
            }),
          )
          .describe('All projects for the account (empty if none)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async () => {
      const projects = await client.get<Array<{
        id: string;
        name: string;
        context_type: string;
        created_at: string;
      }>>('/projects');

      const text = projects.length === 0
        ? 'No projects found.'
        : projects.map((p) =>
            `- ${p.name} (id: ${p.id}, type: ${p.context_type}, created: ${p.created_at.slice(0, 10)})`
          ).join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            contextType: p.context_type,
            createdAt: p.created_at.slice(0, 10),
          })),
        },
      };
    }),
  );

  server.registerTool(
    'get_project_stats',
    {
      title: 'Project health stats',
      description: 'Get health stats for a project: event volume, session count, agent calls, and status.',
      inputSchema: { projectId: projectIdSchema },
      outputSchema: {
        status: z.string().describe('Overall project health status'),
        events24h: z.number().describe('Events in the last 24 hours'),
        sessions24h: z.number().describe('Sessions in the last 24 hours'),
        agentCalls: z.number().describe('Total agent (MCP/API) calls'),
        lastEventAt: z.string().nullable().describe('ISO timestamp of the last event, or null'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      const stats = await client.get<{
        status: string;
        events24h: number;
        sessions24h: number;
        agentCalls: number;
        lastEventAt: string | null;
      }>(`/projects/${id}/health`);

      const text = [
        `Status: ${stats.status}`,
        `Events (24h): ${stats.events24h}`,
        `Sessions (24h): ${stats.sessions24h}`,
        `Agent calls (total): ${stats.agentCalls}`,
        `Last event: ${stats.lastEventAt ?? 'never'}`,
      ].join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
          status: stats.status,
          events24h: stats.events24h,
          sessions24h: stats.sessions24h,
          agentCalls: stats.agentCalls,
          lastEventAt: stats.lastEventAt,
        },
      };
    }),
  );
}
