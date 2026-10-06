import { describe, it, expect } from 'vitest';
import { ApiClient } from './api-client.js';
import { createMcpServer } from './server.js';
import { TOOL_CATALOG, TOOL_NAMES } from './tool-catalog.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type RegisteredTool = { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } };

/** McpServer keeps registered tools on an internal map (name varies by SDK version). */
function registeredTools(): Record<string, RegisteredTool> {
  const server = createMcpServer(new ApiClient({ apiKey: 'sk_test' })) as any;
  return server._registeredTools ?? server._tools ?? server.tools ?? {};
}

describe('createMcpServer', () => {
  it('registers all tools without throwing and returns a usable McpServer', () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const server = createMcpServer(client);

    expect(server).toBeDefined();
    // McpServer exposes connect(); presence confirms a real server instance.
    expect(typeof (server as any).connect).toBe('function');
  });

  // The expected list used to be a third hand-typed copy here; it is now the
  // catalog every doc surface is checked against, so registry and docs share
  // one source and a tool added to one without the other fails this test.
  it('registers exactly the tools in TOOL_CATALOG', () => {
    const names = Object.keys(registeredTools()).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  // pause_variant shipped with destructiveHint:false, so hosts that confirm
  // destructive tools ran it without asking. Every write tool must state its
  // hints explicitly, and the catalog's read/write split must match the
  // registry's readOnlyHint.
  it('annotates every tool consistently with its catalog access', () => {
    const tools = registeredTools();
    for (const entry of TOOL_CATALOG) {
      const ann = tools[entry.name]?.annotations ?? {};
      if (entry.access === 'read') {
        expect(ann.readOnlyHint, entry.name).toBe(true);
      } else {
        expect(ann.readOnlyHint, entry.name).toBe(false);
        expect(typeof ann.destructiveHint, entry.name).toBe('boolean');
        expect(typeof ann.idempotentHint, entry.name).toBe('boolean');
      }
    }
    for (const name of ['pause_variant', 'retire_variant', 'delete_variant_draft', 'update_variant', 'review_cell']) {
      expect(tools[name]?.annotations?.destructiveHint, name).toBe(true);
    }
  });

  // README.md and AGENTS.md ship in the npm tarball and the public repo, and
  // both had drifted from the registry (17 and 20 tools vs 24). The monorepo
  // doc surfaces are checked in apps/api (mcp-tool-surfaces.test.ts); these two
  // live beside this package, so they are checked here.
  for (const file of ['README.md', 'AGENTS.md']) {
    it(`${file} lists exactly the registered tools`, () => {
      const text = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf-8');
      const regions = [...text.matchAll(/<!-- mcp-tools:start -->([\s\S]*?)<!-- mcp-tools:end -->/g)].map((m) => m[1]!);
      expect(regions.length, `${file} has no mcp-tools markers`).toBeGreaterThan(0);
      const listed = new Set(
        regions.flatMap((r) => [...r.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!)),
      );
      const catalog = new Set(TOOL_NAMES);
      expect([...catalog].filter((n) => !listed.has(n)), `${file} is missing`).toEqual([]);
      expect([...listed].filter((n) => !catalog.has(n)), `${file} lists unknown`).toEqual([]);
    });
  }

  it('advertises the MCP Apps (io.modelcontextprotocol/ui) extension capability', () => {
    const client = new ApiClient({ apiKey: 'sk_test' });
    const server = createMcpServer(client) as any;

    // The low-level Server echoes these in the initialize result. A spec-aware
    // host/scanner negotiates MCP Apps off this exact key + mime type.
    const caps = server.server.getCapabilities();
    expect(caps.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes).toEqual([
      'text/html;profile=mcp-app',
    ]);
    // Registering tools/resources must not clobber the extension capability.
    expect(caps.tools).toBeDefined();
    expect(caps.resources).toBeDefined();
  });
});
