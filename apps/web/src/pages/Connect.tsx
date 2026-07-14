import { Link } from 'react-router-dom';
import { useMeta } from '@/hooks';
import { CodeBlock } from '@/components/CodeBlock';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MCP_TOOLS: Array<{ name: string; description: string }> = [
  { name: 'remember_context', description: 'Store a new memory (content, scope, kind, tags, confidence).' },
  { name: 'recall_context', description: 'Semantic search over memories, ranked by relevance to a query.' },
  { name: 'list_context', description: 'Browse memories with filters (scope, kind, tag, source app).' },
  { name: 'forget_context', description: 'Delete a memory by id.' },
  { name: 'list_scopes', description: 'List the scopes the key can read and write.' },
];

const INLINE_CODE = 'rounded bg-muted px-1 py-px font-mono text-[0.7rem]';

export default function ConnectPage() {
  const { data: meta } = useMeta();
  const origin = window.location.origin;

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

  const codexConfig = [
    '[mcp_servers.echo]',
    'command = "npx"',
    'args = ["-y", "echo-context-mcp"]',
    `env = { ECHO_URL = "${origin}", ECHO_API_KEY = "YOUR_API_KEY" }`,
  ].join('\n');

  return (
    <div>
      <PageHeader
        title="Connect AI apps"
        subtitle={
          <>
            Wire Claude, Cursor, or any MCP client to this Echo server. First,{' '}
            <Link to="/keys" className="font-medium text-foreground underline underline-offset-4">
              create an API key
            </Link>{' '}
            — then replace <code className={INLINE_CODE}>YOUR_API_KEY</code> below.
          </>
        }
      />

      {meta && (
        <div className="mb-5">
          <Badge variant="outline" className="gap-2 py-1 pl-2.5 pr-3 text-muted-foreground">
            <span className={cn('size-2 shrink-0 rounded-full', meta.embeddings ? 'bg-success' : 'bg-warning')} />
            {meta.embeddings
              ? `Semantic search: ${meta.embeddings.provider}/${meta.embeddings.model}`
              : 'Keyword search only — configure EMBEDDINGS_PROVIDER for semantic recall'}
          </Badge>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Claude Code</CardTitle>
            <CardDescription>Add Echo as a remote MCP server with one command.</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={`claude mcp add --transport http echo ${origin}/mcp --header "Authorization: Bearer YOUR_API_KEY"`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Claude Desktop / Cursor (stdio bridge)</CardTitle>
            <CardDescription>
              For clients that only speak stdio, use the <code className={INLINE_CODE}>echo-context-mcp</code>{' '}
              bridge. Add this to your MCP config file (e.g.{' '}
              <code className={INLINE_CODE}>claude_desktop_config.json</code> or{' '}
              <code className={INLINE_CODE}>.cursor/mcp.json</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={stdioConfig} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Codex / ChatGPT</CardTitle>
            <CardDescription>
              For the Codex CLI, add Echo to <code className={INLINE_CODE}>~/.codex/config.toml</code>. In ChatGPT,
              enable developer mode and add a remote MCP connector pointing at the endpoint below.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Codex CLI (config.toml)</div>
              <CodeBlock code={codexConfig} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                ChatGPT connector (remote MCP)
              </div>
              <CodeBlock code={`${origin}/mcp`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Any remote-MCP client</CardTitle>
            <CardDescription>
              Echo speaks Streamable HTTP MCP — point any compatible client at the endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Endpoint</div>
              <CodeBlock code={`${origin}/mcp`} />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Header</div>
              <CodeBlock code={`Authorization: Bearer YOUR_API_KEY`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available tools</CardTitle>
            <CardDescription>Every connected app gets these five MCP tools.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              {MCP_TOOLS.map((tool, i) => (
                <div
                  key={tool.name}
                  className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2.5', i > 0 && 'border-t')}
                >
                  <Badge variant="outline" className="w-36 justify-start rounded-md font-mono">
                    {tool.name}
                  </Badge>
                  <span className="min-w-0 flex-1 text-xs/relaxed text-muted-foreground">{tool.description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
