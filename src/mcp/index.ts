#!/usr/bin/env node
/**
 * TraceUI MCP Server
 * Exposes React component static analysis as MCP tools for AI agents
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'traceui-mcp-server',
  version: '0.2.1',
});

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exits
}

main().catch(err => {
  process.stderr.write(`TraceUI MCP Server error: ${err}\n`);
  process.exit(1);
});
