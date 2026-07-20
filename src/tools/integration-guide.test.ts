import { describe, it, expect, vi } from 'vitest';
import { registerIntegrationGuideTools } from './integration-guide.js';

function makeServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    registerTool: vi.fn((name: string, _config: unknown, handler: Function) => { tools[name] = { handler }; }),
    tools,
  };
}

describe('get_integration_guide', () => {
  it('registers and returns the ladder guide', async () => {
    const server = makeServer();
    registerIntegrationGuideTools(server as any);
    expect(server.tools['get_integration_guide']).toBeDefined();

    const result = await server.tools['get_integration_guide']!.handler({});
    const text = result.content[0].text as string;
    expect(result.content[0].type).toBe('text');
    expect(text).toContain('npx @sentientui/cli init');
    expect(text).toContain('useAdaptiveTokens');
    expect(text).toContain('useAdaptive');
    expect(text).toContain('AdaptiveGroup');
    expect(text).toContain('data-sentient-persona');
    expect(text).toContain('suppressHydrationWarning');
  });
});
