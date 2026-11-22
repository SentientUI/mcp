import { describe, it, expect } from 'vitest';
import { ApiClient } from './api-client.js';
import { createMcpServer } from './server.js';
import { APP_ONLY_TOOL_CATALOG, APP_ONLY_TOOL_NAMES, TOOL_CATALOG, TOOL_NAMES } from './tool-catalog.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type RegisteredTool = {
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  _meta?: { ui?: { visibility?: string[] } };
};

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
  it('registers exactly the tools in TOOL_CATALOG plus the app-only ones', () => {
    const names = Object.keys(registeredTools()).sort();
    expect(names).toEqual([...TOOL_NAMES, ...APP_ONLY_TOOL_NAMES].sort());
    expect(new Set([...TOOL_NAMES, ...APP_ONLY_TOOL_NAMES]).size).toBe(TOOL_NAMES.length + APP_ONLY_TOOL_NAMES.length);
  });

  // An app-only tool is hidden from the agent by a spec host. Marking an
  // agent-facing tool that way would silently take a capability away from
  // every agent (e.g. review_cell, if the review view's buttons had reused it).
  it('marks exactly the app-only tools visibility ["app"], and no agent-facing tool', () => {
    const tools = registeredTools();
    for (const name of APP_ONLY_TOOL_NAMES) {
      expect(tools[name]?._meta?.ui?.visibility, name).toEqual(['app']);
    }
    for (const name of TOOL_NAMES) {
      const vis = tools[name]?._meta?.ui?.visibility;
      if (vis !== undefined) expect(vis, name).toContain('model');
    }
  });

  // pause_variant shipped with destructiveHint:false, so hosts that confirm
  // destructive tools ran it without asking. Every write tool must state its
  // hints explicitly, and the catalog's read/write split must match the
  // registry's readOnlyHint.
  it('annotates every tool consistently with its catalog access', () => {
    const tools = registeredTools();
    for (const entry of [...TOOL_CATALOG, ...APP_ONLY_TOOL_CATALOG]) {
      const ann = tools[entry.name]?.annotations ?? {};
      if (entry.access === 'read') {
        expect(ann.readOnlyHint, entry.name).toBe(true);
      } else {
        expect(ann.readOnlyHint, entry.name).toBe(false);
        expect(typeof ann.destructiveHint, entry.name).toBe('boolean');
        expect(typeof ann.idempotentHint, entry.name).toBe('boolean');
      }
    }
    for (const name of ['pause_variant', 'retire_variant', 'delete_variant_draft', 'update_variant', 'review_cell', 'review_cell_from_view']) {
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

  // Decision #5 of the 2026-11-04 first-week plan: an agent on MCP gets the
  // same facts the dashboard and its assistant state. These are the ones both
  // got wrong in prod: a cluster reported as a persona's visitors, and a server
  // goal call in a shape no SDK has.
  it('sends server instructions with the audience, migrate, funnel and server-goal facts', () => {
    const server = createMcpServer(new ApiClient({ apiKey: 'sk_test' })) as any;
    const text: string = server.server._instructions;
    expect(text).toBe(SERVER_INSTRUCTIONS);
    expect(text).toMatch(/serves ONLY on visits where the site declares it/);
    expect(text).toMatch(/init\(\{ persona \}\)/);
    expect(text).toMatch(/window\.sentient\.persona/);
    expect(text).toMatch(/not personas or audiences/);
    expect(text).toMatch(/migrate_component/);
    expect(text).toMatch(/every step must have something that sends it/);
    expect(text).toContain(
      "await trackServerGoal({ serverKey: process.env.SENTIENT_SECRET_KEY!, userId: user.id, name: 'subscribed', dedupeKey: user.id });",
    );
    expect(text).not.toMatch(/sentientui\.trackServerGoal/);
    // Internal traffic: the controls that exist, and the honest limits.
    expect(text).toMatch(/Settings -> Internal traffic/);
    expect(text).toMatch(/identify\(userId, \{ email \}\)/);
    expect(text).toMatch(/never the address/);
    expect(text).toMatch(/There is no report filter or IP rule/);
    expect(text).toMatch(/get_internal_traffic_rules/);
    // Every tool it names is a real one.
    for (const m of text.matchAll(/\b(?:get|list|manage)_[a-z_]+\b/g)) expect(TOOL_NAMES).toContain(m[0]);
  });
});
