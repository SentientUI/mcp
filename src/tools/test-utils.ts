/** The subset of an MCP tool result the tool tests assert against. */
export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
};

/**
 * Signature of a registered MCP tool handler, as captured by the `makeServer()`
 * test mocks. Replaces the unsafe `Function` type so tests stay type-checked
 * against the shape they actually invoke: `handler(args) -> Promise<ToolResult>`.
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
