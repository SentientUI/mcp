import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api-client.js';

const projectIdSchema = z.string().uuid().describe('The project UUID');

type ComponentRow = { component_id: string; variants: Array<{ variant_id: string }> };
type GoalRow = { goalName: string };
type GoalsResponse = { goals?: GoalRow[] } | GoalRow[];

async function settled<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

/** Register the get_test_brief tool: returns paste-ready tests for a component. */
export function registerTestBriefTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get_test_brief',
    {
      title: 'Test brief',
      description: 'Get a ready-to-paste test for a SentientUI-wrapped component, populated with the component\'s real variants and goals. This project uses @sentientui/react/testing. Use this so your tests force a specific variant/layout deterministically and never break when the optimizer serves a different version. Returns a React Testing Library example plus the URL-param recipe for E2E (Playwright/Cypress).',
      inputSchema: {
        projectId: projectIdSchema,
        componentId: z.string().describe('The component ID to write a test for (matches <Adaptive id="...">).'),
      },
      outputSchema: {
        componentId: z.string(),
        forcedVariantId: z.string().describe('The non-control variant the example forces'),
        goalName: z.string().describe('The goal the example asserts fires'),
        markdown: z.string().describe('The full test brief in Markdown'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, componentId }) => {
      const id = encodeURIComponent(projectId);
      const [componentsEnvelope, goalsRes] = await Promise.all([
        // mgmt API returns a paginated envelope: { components, total, page, limit }.
        settled(client.get<{ components: ComponentRow[] }>(`/projects/${id}/components`)),
        settled(client.get<GoalsResponse>(`/projects/${id}/goals`)),
      ]);

      const components = componentsEnvelope?.components ?? [];
      const component = components.find((c) => c.component_id === componentId) ?? null;
      const variantIds = component?.variants.map((v) => v.variant_id) ?? [];
      const goals = Array.isArray(goalsRes) ? goalsRes : (goalsRes?.goals ?? []);
      const goalName = goals[0]?.goalName ?? 'signup';

      // Choose a non-control variant to force in the example when one exists.
      const controlId = variantIds[0] ?? 'control';
      const forcedId = variantIds.find((v) => v !== controlId) ?? 'variant_b';

      const lines: string[] = [];
      lines.push(`# Test brief — ${componentId}`);
      lines.push('');
      lines.push('This project uses **`@sentientui/react/testing`**. By default SentientUI serves the *control* variant and default layout in tests and sends no events, so existing tests are unaffected. Pass a scenario to force a specific variant/layout.');
      if (!component) {
        lines.push('');
        lines.push(`Note: no component named "${componentId}" has reported data yet. If you are adding this \`<Adaptive>\`, that is expected — the example below uses placeholder variant IDs; replace them with the ones you declare in \`variants={{ … }}\`.`);
      }
      lines.push('');
      lines.push('## React Testing Library');
      lines.push('```tsx');
      lines.push(`import { renderWithSentient } from '@sentientui/react/testing';`);
      lines.push(`import { screen } from '@testing-library/react';`);
      lines.push('');
      lines.push(`test('${componentId}: forces the "${forcedId}" variant', () => {`);
      lines.push(`  renderWithSentient(<YourPage />, { variants: { ${componentId}: '${forcedId}' } });`);
      lines.push(`  // assert on the ${forcedId} variant's content:`);
      lines.push(`  // expect(screen.getByText('…')).toBeInTheDocument();`);
      lines.push('});');
      lines.push('```');
      lines.push('');
      lines.push('## Assert a goal fires (with the mock server)');
      lines.push('```tsx');
      lines.push(`import { setupSentientServer } from '@sentientui/react/testing/node';`);
      lines.push(`import { getSentientEvents, hasFiredGoal } from '@sentientui/react/testing';`);
      lines.push('');
      lines.push(`const s = setupSentientServer();`);
      lines.push(`afterAll(() => s.server.close());`);
      lines.push('');
      lines.push(`test('${componentId}: fires the ${goalName} goal', async () => {`);
      lines.push(`  s.use({ variants: { ${componentId}: '${forcedId}' } });`);
      lines.push(`  // …render with a live client, trigger the interaction…`);
      lines.push(`  expect(hasFiredGoal(getSentientEvents(), '${goalName}')).toBe(true);`);
      lines.push('});');
      lines.push('```');
      lines.push('');
      lines.push('## E2E (Playwright / Cypress)');
      lines.push(`Use \`mockSentient\` to force variants/layout, stub the API, and capture events:`);
      lines.push('```ts');
      lines.push(`import { mockSentient } from '@sentientui/react/testing';`);
      lines.push('');
      lines.push(`const s = await mockSentient(page, { variants: { ${componentId}: '${forcedId}' } });`);
      lines.push(`await page.goto('/');`);
      lines.push(`expect(s.events().some((e) => e.goalType === '${goalName}')).toBe(true);`);
      lines.push('```');
      lines.push(`Cypress: \`mockSentientCypress(cy, scenario)\` in a beforeEach. **Prefer mockSentient in CI — it writes nothing.**`);
      lines.push(`The URL param below is fine for a quick local pin, but a live client still creates an (automation-flagged) session:`);
      lines.push('```ts');
      lines.push(`await page.goto('/?sentient_variant=${componentId}:${forcedId}');`);
      lines.push('```');

      const markdown = lines.join('\n');
      return {
        content: [{ type: 'text' as const, text: markdown }],
        structuredContent: { componentId, forcedVariantId: forcedId, goalName, markdown },
      };
    },
  );
}
