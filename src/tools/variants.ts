import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';
import { projectIdSchema, untrusted, withApiErrorGuidance } from './common.js';

export function registerVariantWriteTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'create_variant',
    {
      title: 'Create managed variant',
      description: 'Create a NO-CODE managed text variant for a component (content stored in SentientUI, rendered by <AdaptiveText>). Use this ONLY for text-only variants the user wants without a code change. For variants that will live in the codebase (full components — copy, markup, styling), use get_variant_brief and write the variant in code instead; those auto-register on deploy and do not need create_variant. Works on every plan with an editor/admin login or the project\'s sk_ server key (anonymous demo tokens are read-only). The variant is created as a DRAFT — it serves no traffic until activated with update_variant (status \'active\'). Confirm the text with the user before calling. On a component that has moved to the shared track, the text is added to the component\'s versions instead (still a draft until activated), and text is required there (an empty create is refused); the call and its result are otherwise the same.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID to add a variant to'),
        displayName: z.string().min(1).max(200).describe('Human-readable name for the new variant'),
        content: z.string().max(10000).optional().describe('The text content for this managed variant (rendered by <AdaptiveText>). Generate it from get_variant_brief context; omit only to create an empty placeholder to fill in from the dashboard.'),
      },
      outputSchema: {
        variantId: z.string().describe('The new variant ID'),
        // API returns `body.displayName ?? null`, so a successful create can
        // carry a null name — match that contract or outputSchema validation
        // would reject an otherwise-successful response.
        displayName: z.string().nullable(),
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
    withApiErrorGuidance(async ({ projectId, componentId, displayName, content }) => {
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
          text: `Managed text variant created: ${result.variantId} ("${result.displayName}") for component ${componentId}${contentNote}. It is a draft and serves no traffic yet — after the user confirms, activate it with update_variant (status 'active'), or delete it with delete_variant_draft. Reminder: this is a no-code managed variant; for code-native variants, edit the code instead (see get_variant_brief).`,
        }],
        structuredContent: {
          variantId: result.variantId,
          displayName: result.displayName,
          componentId,
          state: 'draft' as const,
          hasContent: Boolean(content),
        },
      };
    }),
  );

  server.registerTool(
    'pause_variant',
    {
      title: 'Pause variant',
      description:
        'Pause a variant: no new traffic is assigned to it until it is resumed. This changes what live visitors see, ' +
        'so CONFIRM with the user before calling. Undo with resume_variant.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The variant ID to pause'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        paused: z.literal(true).describe('The variant is now paused'),
      },
      // destructiveHint was false, so hosts that gate destructive tools behind a
      // confirmation ran this without asking — yet it pulls a live arm out of
      // serving for every visitor. It is reversible (resume_variant), but the
      // hint is about the change to the environment, not about undo.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/variants/pause`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${untrusted(variantId)} in component ${untrusted(componentId)} is paused. No new traffic will be assigned to it. Undo with resume_variant.`,
        }],
        structuredContent: { variantId, componentId, paused: true as const },
      };
    }),
  );

  // Reversal tools (audit M3). The API has always supported undoing every write
  // above — unpause, edit, delete a draft, retire, restore — but the MCP exposed
  // none of it, so an agent that paused the wrong arm or created a bad draft had
  // to send the user to the dashboard, and AGENTS.md had to warn that
  // pause_variant was irreversible.
  server.registerTool(
    'resume_variant',
    {
      title: 'Resume variant',
      description:
        'Resume a paused variant so it is assigned traffic again — works for a manual pause (pause_variant) and for a ' +
        'guardrail auto-pause (see list_guardrail_events). Resuming a guardrail-paused arm puts a variant the guardrail ' +
        'judged harmful back in front of visitors, so CONFIRM with the user first.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The paused variant ID to resume'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        paused: z.literal(false).describe('The variant is no longer paused'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/guardrails/${encodeURIComponent(componentId)}/unpause`, {
        variantIds: [variantId],
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${untrusted(variantId)} in component ${untrusted(componentId)} is resumed and will be assigned traffic again.`,
        }],
        structuredContent: { variantId, componentId, paused: false as const },
      };
    }),
  );

  server.registerTool(
    'update_variant',
    {
      title: 'Update managed variant',
      description:
        'Edit a NO-CODE managed variant (one created with create_variant or in the dashboard): its display name, its text, ' +
        "or its status — 'active' starts serving it to visitors, 'draft' takes it back out of rotation. Code-native " +
        'variants cannot be edited here (change the code). Overwriting text or activating changes what live visitors see, ' +
        'so CONFIRM with the user first. Omit a field to leave it unchanged. On a component that has moved to the shared track ' +
        "(one experiment with its versions), the text is edited on that component's version instead; the call and its result are the same.",
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The managed variant ID (dm_…)'),
        displayName: z.string().min(1).max(200).optional().describe('New display name'),
        content: z.string().max(10000).optional().describe('New text content (replaces the old text)'),
        status: z.enum(['draft', 'active']).optional().describe("'active' serves it; 'draft' stops serving it"),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        changed: z.array(z.string()).describe('Fields that were sent for update'),
        status: z.enum(['draft', 'active']).nullable().describe('The new status, or null when unchanged'),
      },
      // Destructive: the previous text is overwritten, not versioned.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId, displayName, content, status }) => {
      const changed = [
        ...(displayName !== undefined ? ['displayName'] : []),
        ...(content !== undefined ? ['content'] : []),
        ...(status !== undefined ? ['status'] : []),
      ];
      if (changed.length === 0) {
        // The API accepts an empty PATCH and answers ok, which would read as
        // "updated" while nothing changed.
        return {
          content: [{ type: 'text' as const, text: 'Nothing to update — pass displayName, content and/or status.' }],
          isError: true,
        };
      }
      const id = encodeURIComponent(projectId);
      await client.patch(`/projects/${id}/variants`, { componentId, variantId, displayName, content, status });
      const statusNote =
        status === 'active'
          ? ' It is now ACTIVE and will be assigned traffic.'
          : status === 'draft'
            ? ' It is now a draft and no longer serves traffic.'
            : '';
      return {
        content: [{
          type: 'text' as const,
          text: `Managed variant ${untrusted(variantId)} in component ${untrusted(componentId)} updated (${changed.join(', ')}).${statusNote}`,
        }],
        structuredContent: { variantId, componentId, changed, status: status ?? null },
      };
    }, {
      // PATCH matches managed variants only, so a code-native id answers a
      // bare not_found that read as "that variant does not exist".
      not_found:
        'No MANAGED variant with that id exists in this component. Code-native variants (declared in <Adaptive variants>) are edited in the code, not here — check ids with list_components (a wrong projectId answers the same way).',
    }),
  );

  server.registerTool(
    'delete_variant_draft',
    {
      title: 'Delete draft variant',
      description:
        'Permanently delete a managed variant that is still a DRAFT (never activated). Active variants cannot be deleted — ' +
        'pause or retire them instead. CONFIRM with the user first: this cannot be undone.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The draft managed variant ID (dm_…)'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        deleted: z.literal(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.delete(`/projects/${id}/variants`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Draft variant ${untrusted(variantId)} in component ${untrusted(componentId)} was deleted.`,
        }],
        structuredContent: { variantId, componentId, deleted: true as const },
      };
    }, {
      // The API's DELETE matches managed drafts only, so an active or
      // code-native variant answers a bare not_found — say why.
      not_found:
        'No managed DRAFT variant with that id exists in this component. Active and code-native variants cannot be deleted — use pause_variant or retire_variant instead (check ids with list_components; a wrong projectId answers the same way).',
    }),
  );

  server.registerTool(
    'retire_variant',
    {
      title: 'Retire variant',
      description:
        'Retire (archive) an ACTIVE variant: it stops serving and moves to the archived list. Works for code-native ' +
        'variants that were removed from the code and linger. A promoted (pinned) variant must be unpromoted in the ' +
        'dashboard first. CONFIRM with the user first; undo with restore_variant.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The active variant ID to retire'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        status: z.literal('retired'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/variants/retire`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${untrusted(variantId)} in component ${untrusted(componentId)} is retired and no longer serves. Undo with restore_variant.`,
        }],
        structuredContent: { variantId, componentId, status: 'retired' as const },
      };
    }, {
      variant_promoted:
        'This variant is promoted (pinned as the winner), so it cannot be retired. Unpromote it in the dashboard first, then retry.',
      not_found:
        'No ACTIVE variant with that id exists in this component (it may already be retired, or still a draft), or the projectId is wrong. Check ids with list_components.',
    }),
  );

  server.registerTool(
    'restore_variant',
    {
      title: 'Restore variant',
      description:
        'Bring a RETIRED variant back to active so it serves again. For a managed draft that was never activated use ' +
        "update_variant (status 'active') instead. Restoring does not clear a pause — use resume_variant for that. " +
        'CONFIRM with the user first.',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().min(1).max(200).describe('The component ID'),
        variantId: z.string().min(1).max(200).describe('The retired variant ID to restore'),
      },
      outputSchema: {
        variantId: z.string(),
        componentId: z.string(),
        status: z.literal('active'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withApiErrorGuidance(async ({ projectId, componentId, variantId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/variants/restore`, { componentId, variantId });
      return {
        content: [{
          type: 'text' as const,
          text: `Variant ${untrusted(variantId)} in component ${untrusted(componentId)} is active again. If it was also paused, call resume_variant.`,
        }],
        structuredContent: { variantId, componentId, status: 'active' as const },
      };
    }),
  );

  server.registerTool(
    'refresh_insights',
    {
      title: 'Refresh insights',
      // The plan and role gates were undocumented, so agents on Free called it
      // and got a bare 403 they could not explain to the user.
      description:
        'Trigger fresh AI insight generation for a project (a paid model call). Needs the Starter plan or higher and an ' +
        'editor/admin role (anonymous demo tokens are read-only); advisor recommendations additionally need Growth or higher. ' +
        'Returns immediately; call get_insights in ~15 seconds to see results.',
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
    withApiErrorGuidance(async ({ projectId }) => {
      const id = encodeURIComponent(projectId);
      await client.post(`/projects/${id}/insights/refresh`);
      return {
        content: [{
          type: 'text' as const,
          text: `Insights are generating for project ${projectId}. Call get_insights in ~15 seconds to see the results.`,
        }],
        structuredContent: { projectId, status: 'generating' as const },
      };
    }),
  );
}
