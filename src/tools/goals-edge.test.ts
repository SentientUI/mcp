import { describe, it, expect, vi } from 'vitest';
import type { ToolHandler } from './test-utils.js';
import { ApiClient } from '../api-client.js';
import { registerGoalTools } from './goals.js';

function makeServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: ToolHandler) => { tools[name] = { handler }; }),
    tools,
  };
}

async function run(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerGoalTools(server as any, client);
  const result = await server.tools['get_goal_funnel']!.handler({ projectId: 'p1' });
  return result.content[0].text as string;
}

async function runListGoals(data: unknown) {
  const client = new ApiClient({ apiKey: 'sk_test' });
  vi.spyOn(client, 'get').mockResolvedValue(data as any);
  const server = makeServer();
  registerGoalTools(server as any, client);
  return server.tools['list_goals']!.handler({ projectId: 'p1' });
}

describe('get_goal_funnel — formatting and nested variants', () => {
  it('formats goal pct as pct*100 to 1 decimal and includes hit/session counts', async () => {
    // pct 0.2345 * 100 = 23.4499... in IEEE754, so toFixed(1) -> 23.4 (not 23.5).
    const text = await run({
      goals: [{ goalName: 'purchase', hits: 50, uniqueSessions: 48, pct: 0.2345, variants: [] }],
    });
    expect(text).toContain('purchase: 50 hits, 48 unique sessions, 23.4% conversion');
  });

  it('renders a nested per-variant completion-rate breakdown', async () => {
    const text = await run({
      goals: [{
        goalName: 'signup',
        hits: 30,
        uniqueSessions: 30,
        pct: 0.1,
        variants: [
          { componentId: 'hero', variantId: 'v_a', completionRate: 0.12 },
          { componentId: 'hero', variantId: 'v_b', completionRate: 0.085 },
        ],
      }],
    });
    expect(text).toContain('signup: 30 hits, 30 unique sessions, 10.0% conversion');
    expect(text).toContain('  hero/v_a: 12.0% per assigned session');
    expect(text).toContain('  hero/v_b: 8.5% per assigned session');
  });

  it('trims the trailing blank line between goals', async () => {
    const text = await run({
      goals: [{ goalName: 'lead', hits: 1, uniqueSessions: 1, pct: 0.5, variants: [] }],
    });
    // flatMap appends '' after each goal; output is .trim()'d so no trailing newline.
    expect(text.endsWith('\n')).toBe(false);
    expect(text).toBe('lead: 1 hits, 1 unique sessions, 50.0% conversion');
  });

  it('shows empty-state message when no goals configured', async () => {
    const text = await run({ goals: [] });
    expect(text).toContain('No goals configured for this project.');
  });
});

describe('list_goals — definitions including zero-conversion goals', () => {
  it('lists each goal with id, role, event, and display name, plus code-usage guidance', async () => {
    const result = await runListGoals({
      goals: [
        { goal_id: 'demo_requested', display_name: 'Demo requested', role: 'primary', event: 'click', url_pattern: null, status: 'active' },
        { goal_id: 'thanks_page', display_name: 'Reached thanks page', role: 'secondary', event: 'url_reached', url_pattern: '/thanks', status: 'active' },
      ],
    });
    const text = result.content[0].text as string;
    expect(text).toContain('demo_requested (primary, click) — Demo requested');
    expect(text).toContain('thanks_page (secondary, url_reached) — Reached thanks page');
    expect(text).toContain("client.goal('<goalId>')");
    expect(result.structuredContent).toEqual({
      goals: [
        { goalId: 'demo_requested', displayName: 'Demo requested', role: 'primary', event: 'click', urlPattern: null, status: 'active' },
        { goalId: 'thanks_page', displayName: 'Reached thanks page', role: 'secondary', event: 'url_reached', urlPattern: '/thanks', status: 'active' },
      ],
    });
  });

  it('marks archived goals inline', async () => {
    const result = await runListGoals({
      goals: [{ goal_id: 'old_goal', display_name: 'Old goal', role: 'secondary', event: 'click', url_pattern: null, status: 'archived' }],
    });
    expect(result.content[0].text as string).toContain('old_goal (secondary, click, archived) — Old goal');
  });

  it('empty state points at the dashboard and chat, never claims goals are impossible', async () => {
    const result = await runListGoals({ goals: [] });
    expect(result.content[0].text as string).toContain('No goal definitions yet');
    expect(result.structuredContent).toEqual({ goals: [] });
  });
});
