// Library entry — lets other workspace packages (e.g. apps/api's remote /mcp
// endpoint) reuse the exact same tool registry the stdio CLI serves, so there
// is a single source of truth for tool behaviour. Side-effect free: importing
// this must never start a server or touch argv (that's src/index.ts's job).
export { createMcpServer } from './server.js';
export { ApiClient, ApiError } from './api-client.js';
