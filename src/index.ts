#!/usr/bin/env node

import { WebBaselineMCPServer } from './mcp-server.js';
import { SSEServer } from './sse-server.js';

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'mcp';

  if (mode === 'sse') {
    // Start SSE server
    const port = parseInt(process.env.PORT || '3001');
    const sseServer = new SSEServer();
    sseServer.start(port);
  } else {
    // Start MCP server (default)
    const mcpServer = new WebBaselineMCPServer();
    await mcpServer.start();
  }
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});