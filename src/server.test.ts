import { describe, it, expect } from 'vitest';
import { ApiClient } from './api-client.js';
import { createMcpServer } from './server.js';

describe('createMcpServer', () => {
  it('registers all tools without throwing and returns a usable McpServer', () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const server = createMcpServer(client);

    expect(server).toBeDefined();
    // McpServer exposes connect(); presence confirms a real server instance.
    expect(typeof (server as any).connect).toBe('function');
  });

  it('registers every expected tool name', () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const server = createMcpServer(client) as any;

    // McpServer keeps registered tools on an internal map; reach in to assert
    // the full set is wired up. Falls back to _registeredTools across SDK versions.
    const registered =
      server._registeredTools ?? server._tools ?? server.tools ?? {};
    const names = Object.keys(registered);

    const expected = [
      'list_projects',
      'create_project',
      'get_project_stats',
      'list_components',
      'get_variant_performance',
      'get_insights',
      'get_persona_breakdown',
      'get_goal_funnel',
      'list_guardrail_events',
      'get_layout_stats',
      'get_variant_brief',
      'get_test_brief',
      'create_variant',
      'pause_variant',
      'refresh_insights',
      'get_integration_guide',
    ];

    for (const name of expected) {
      expect(names).toContain(name);
    }
    expect(names.length).toBe(expected.length);
  });
});
