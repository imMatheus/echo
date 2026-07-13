import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ServerMeta } from '@echo/shared';
import * as api from '../api';
import { CodeBlock } from '../components/CodeBlock';

const MCP_TOOLS: Array<{ name: string; description: string }> = [
  { name: 'remember_context', description: 'Store a new memory (content, scope, kind, tags, confidence).' },
  { name: 'recall_context', description: 'Semantic search over memories, ranked by relevance to a query.' },
  { name: 'list_context', description: 'Browse memories with filters (scope, kind, tag, source app).' },
  { name: 'forget_context', description: 'Delete a memory by id.' },
  { name: 'list_scopes', description: 'List the scopes the key can read and write.' },
];

export default function ConnectPage() {
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const origin = window.location.origin;

  useEffect(() => {
    api
      .getMeta()
      .then(setMeta)
      .catch(() => {
        // status line just won't render
      });
  }, []);

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        echo: {
          command: 'npx',
          args: ['-y', 'echo-context-mcp'],
          env: {
            ECHO_URL: origin,
            ECHO_API_KEY: 'YOUR_API_KEY',
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Connect AI apps</h1>
          <p className="subtitle">
            Wire Claude, Cursor, or any MCP client to this Echo server. First,{' '}
            <Link to="/keys">create an API key</Link> — then replace <code>YOUR_API_KEY</code> below.
          </p>
        </div>
      </div>

      {meta && (
        <div style={{ marginBottom: 20 }}>
          {meta.embeddings ? (
            <span className="status-line">
              <span className="status-dot ok" />
              Semantic search: {meta.embeddings.provider}/{meta.embeddings.model}
            </span>
          ) : (
            <span className="status-line">
              <span className="status-dot warn" />
              Keyword search only — configure EMBEDDINGS_PROVIDER for semantic recall
            </span>
          )}
        </div>
      )}

      <div className="connect-card">
        <h2>Claude Code</h2>
        <p className="desc">Add Echo as a remote MCP server with one command.</p>
        <CodeBlock
          code={`claude mcp add --transport http echo ${origin}/mcp --header "Authorization: Bearer YOUR_API_KEY"`}
        />
      </div>

      <div className="connect-card">
        <h2>Claude Desktop / Cursor (stdio bridge)</h2>
        <p className="desc">
          For clients that only speak stdio, use the <code>echo-context-mcp</code> bridge. Add this to your MCP
          config file (e.g. <code>claude_desktop_config.json</code> or <code>.cursor/mcp.json</code>).
        </p>
        <CodeBlock code={stdioConfig} />
      </div>

      <div className="connect-card">
        <h2>Any remote-MCP client</h2>
        <p className="desc">Echo speaks Streamable HTTP MCP — point any compatible client at the endpoint.</p>
        <div className="field">
          <label>Endpoint</label>
          <CodeBlock code={`${origin}/mcp`} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Header</label>
          <CodeBlock code={`Authorization: Bearer YOUR_API_KEY`} />
        </div>
      </div>

      <div className="connect-card">
        <h2>Available tools</h2>
        <p className="desc">Every connected app gets these five MCP tools.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <span className="chip-mono" style={{ color: 'var(--text)' }}>
                      {tool.name}
                    </span>
                  </td>
                  <td className="muted">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
