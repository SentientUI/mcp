// Library entry — lets other workspace packages (e.g. apps/api's remote /mcp
// endpoint) reuse the exact same tool registry the stdio CLI serves, so there
// is a single source of truth for tool behaviour. Side-effect free: importing
// this must never start a server or touch argv (that's src/index.ts's job).
export { createMcpServer } from './server.js';
export { ApiClient, ApiError } from './api-client.js';
// The static `ui://` template URIs, so a host embedding this registry (the
// remote /mcp endpoint) can allow reading them without a bearer token.
export { PUBLIC_UI_RESOURCE_URIS } from './ui/index.js';
// The registered tool list with one-line summaries — the single source the doc
// surfaces (README, AGENTS.md, docs/mcp-setup.md, llms.txt, the server card)
// are parity-tested against, so they cannot drift from the registry again.
export { TOOL_CATALOG, TOOL_NAMES, type ToolCatalogEntry, type ToolAccess } from './tool-catalog.js';
