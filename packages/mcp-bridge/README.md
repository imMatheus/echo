# echo-context-mcp

stdio MCP bridge for [Echo](../../README.md), the open context layer for AI apps. Use it with MCP clients that only support local stdio servers (Claude Desktop, older Cursor builds, …) — it forwards every tool call to a remote Echo server's REST API.

## Usage

```json
{
  "mcpServers": {
    "echo": {
      "command": "npx",
      "args": ["-y", "echo-context-mcp"],
      "env": {
        "ECHO_URL": "https://your-echo-server.example.com",
        "ECHO_API_KEY": "eck_..."
      }
    }
  }
}
```

Create the API key in the Echo dashboard under **API Keys**.

Tools: `remember_context`, `recall_context`, `list_context`, `forget_context`, `list_scopes` — identical to Echo's native remote MCP endpoint (`POST /mcp`), which you should prefer when your client supports remote MCP servers.
