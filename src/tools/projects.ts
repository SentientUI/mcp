import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiClient, ApiError } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

// The create endpoint legitimately refuses some auth modes; translate those into
// actionable guidance rather than a bare error code, since this is often a new
// user's first interaction.
function createProjectGuidance(err: ApiError): string | null {
  switch (err.message) {
    case 'insufficient_scope':
      return 'Creating a project needs an account login. Connect via the hosted MCP URL (https://api.sentient-ui.com/mcp) and sign in — a project-scoped server key (sk_…) cannot create projects.';
    case 'demo_read_only':
      return 'Demo mode is read-only. Create a SentientUI account and sign in to make projects.';
    case 'insufficient_role':
      return 'Your account role cannot create projects — this needs the account owner or an admin.';
    case 'project_limit_reached':
      return "You've reached your plan's project limit. Upgrade your plan or remove an existing project, then try again.";
    case 'name_required':
      return 'A project name is required to create a project.';
    default:
      return null;
  }
}

export function registerProjectTools(server: McpServer, client: ApiClient): void {
  server.tool(
    'create_project',
    'Create a NEW SentientUI project (onboarding). Returns the project id and its pk_ public key for the SDK. Requires an account login: this works when connected via OAuth (the hosted MCP URL) but NOT with a project-scoped sk_ server key or an anonymous demo token. After it succeeds, call get_integration_guide and help the user install @sentientui/react with the returned key.',
    {
      name: z.string().min(1).describe('Human-readable project name'),
      contextType: z
        .enum(['saas', 'ecommerce', 'marketing', 'internal'])
        .optional()
        .describe('What kind of product this is; defaults to saas'),
      framework: z
        .enum(['next-app', 'next-pages', 'react', 'core'])
        .optional()
        .describe('Frontend framework, used to tailor setup; defaults to next-app'),
      websiteUrl: z
        .string()
        .optional()
        .describe("Production site origin to allow-list so the SDK's events aren't origin-blocked on day one"),
    },
    async ({ name, contextType, framework, websiteUrl }) => {
      try {
        const created = await client.post<{ id: string; apiKey: string }>('/projects', {
          name,
          contextType,
          framework,
          origin: websiteUrl,
        });
        return {
          content: [{
            type: 'text' as const,
            text: [
              `Created project "${name}" (id: ${created.id}, type: ${contextType ?? 'saas'}).`,
              `Public key: ${created.apiKey}`,
              `Next: install @sentientui/react with this key. Ask me to pull the setup guide (get_integration_guide) and I'll wrap your first component.`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        if (err instanceof ApiError) {
          const guidance = createProjectGuidance(err);
          if (guidance) {
            return { content: [{ type: 'text' as const, text: guidance }], isError: true };
          }
        }
        throw err;
      }
    },
  );

  server.tool(
    'list_projects',
    'List all SentientUI projects for the authenticated account.',
    {},
    async () => {
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

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'get_project_stats',
    'Get health stats for a project: event volume, session count, agent calls, and status.',
    { projectId: projectIdSchema },
    async ({ projectId }) => {
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

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
