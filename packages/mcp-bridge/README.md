# echo-context-mcp

stdio MCP bridge for [Echo](../../README.md), the open context layer for AI apps. Use it with MCP clients that only support local stdio servers (Claude Desktop, older Cursor builds, …) — it forwards every tool call to a remote Echo server's REST API.

## Usage

The bridge is not published to npm yet. Build and run the reviewed source from
this repository instead of executing the currently unclaimed package name.
Building requires Bun; the generated bridge runs on Node.js 20 or newer:

```bash
bun install
bun run --filter echo-context-mcp build
```

Use an absolute path to the generated file in the MCP client configuration:

```json
{
  "mcpServers": {
    "echo": {
      "command": "node",
      "args": ["/absolute/path/to/echo/packages/mcp-bridge/dist/index.js"],
      "env": {
        "ECHO_URL": "https://your-echo-server.example.com",
        "ECHO_API_KEY": "eck_..."
      }
    }
  }
}
```

Create the API key in the Echo dashboard under **API Keys**.

Bridge HTTP requests fail after 30 seconds instead of leaving MCP calls hung indefinitely.

Tools: `remember_context`, `recall_context`, `list_context`, `forget_context`, `list_scopes` — identical to Echo's native remote MCP endpoint (`POST /mcp`), which you should prefer when your client supports remote MCP servers.
