import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BookmarkPlusIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  LayersIcon,
  ListIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { useMeta } from '@/hooks';
import { CodeBlock } from '@/components/CodeBlock';
import { PageHeader } from '@/components/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CHART_COLORS, solidTileStyle } from '@/lib/chart-colors';
import { cn } from '@/lib/utils';

const MCP_TOOLS = [
  {
    name: 'remember_context',
    description: 'Store a new memory (content, scope, kind, tags, confidence).',
    icon: BookmarkPlusIcon,
  },
  {
    name: 'recall_context',
    description: 'Semantic search over memories, ranked by relevance to a query.',
    icon: SearchIcon,
  },
  {
    name: 'list_context',
    description: 'Browse memories chronologically with optional scope and pagination.',
    icon: ListIcon,
  },
  { name: 'forget_context', description: 'Delete a memory by id.', icon: Trash2Icon },
  { name: 'list_scopes', description: 'List the scopes the key can read and write.', icon: LayersIcon },
];

const INLINE_CODE = 'rounded bg-muted px-1 py-px font-mono text-[0.7rem]';

const BRIDGE_PATH = '/absolute/path/to/echo/packages/mcp-bridge/dist/index.js';
const BRIDGE_BUILD = [
  'cd /absolute/path/to/echo',
  'bun install',
  'bun run --filter echo-context-mcp build',
].join('\n');

/** One entry in the numbered setup rail. */
function Step({ number, title, description, children }: {
  number: number;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="group relative flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-heading text-[11px] font-semibold">
          {number}
        </div>
        <div className="mt-2 w-px flex-1 bg-border group-last:hidden" />
      </div>
      <div className="min-w-0 flex-1 pb-9 group-last:pb-0">
        <h2 className="font-heading text-sm font-medium leading-6">{title}</h2>
        {description && <p className="mt-0.5 max-w-prose text-xs/relaxed text-muted-foreground">{description}</p>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </li>
  );
}

function Labeled({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Shared "build the stdio bridge" instructions for clients that can't speak remote MCP. */
function BridgeBuildBlock() {
  return (
    <Labeled label="Build the bridge once, from your trusted Echo source checkout">
      <CodeBlock code={BRIDGE_BUILD} />
    </Labeled>
  );
}

export default function ConnectPage() {
  const { data: meta } = useMeta();
  const origin = window.location.origin;
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
  const needsPublicConnectorUrl =
    window.location.protocol !== 'https:' || localHostnames.has(window.location.hostname);
  const chatGptEndpoint = needsPublicConnectorUrl
    ? 'https://your-public-echo.example.com/mcp'
    : `${origin}/mcp`;

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        echo: {
          command: 'node',
          args: [BRIDGE_PATH],
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
    'command = "node"',
    `args = ["${BRIDGE_PATH}"]`,
    `env = { ECHO_URL = "${origin}", ECHO_API_KEY = "YOUR_API_KEY" }`,
  ].join('\n');

  return (
    <div>
      <PageHeader
        title="Connect AI apps"
        subtitle="Give Claude, Cursor, or any MCP client a shared memory on this Echo server — three steps, a couple of minutes."
      />

      <ol>
        <Step
          number={1}
          title="Create an API key"
          description="Every connected app authenticates with a bearer key. Create one and keep it handy — the next step needs it."
        >
          <Link to="/keys" className={cn(buttonVariants({ variant: 'outline' }))}>
            <KeyRoundIcon data-icon="inline-start" />
            Create an API key
          </Link>
        </Step>

        <Step
          number={2}
          title="Add Echo to your app"
          description={
            <>
              Pick your app below, then replace <code className={INLINE_CODE}>YOUR_API_KEY</code> with the key
              from step 1. For stdio clients, also replace{' '}
              <code className={INLINE_CODE}>/absolute/path/to/echo</code> with your checkout's absolute path.
            </>
          }
        >
          <Tabs defaultValue="claude-code">
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
              <TabsTrigger value="cursor">Cursor</TabsTrigger>
              <TabsTrigger value="codex">Codex CLI</TabsTrigger>
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="other">Other</TabsTrigger>
            </TabsList>

            <TabsContent value="claude-code" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                Run this in a terminal — it registers Echo as a remote MCP server for Claude Code.
              </p>
              <CodeBlock
                code={`claude mcp add --transport http echo ${origin}/mcp --header "Authorization: Bearer YOUR_API_KEY"`}
              />
            </TabsContent>

            <TabsContent value="claude-desktop" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                Claude Desktop only speaks stdio, so it connects through the local bridge included in the Echo
                repo.
              </p>
              <BridgeBuildBlock />
              <Labeled
                label={
                  <>
                    Add to <code className={INLINE_CODE}>claude_desktop_config.json</code>
                  </>
                }
              >
                <CodeBlock code={stdioConfig} />
              </Labeled>
            </TabsContent>

            <TabsContent value="cursor" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                Cursor connects over stdio through the local bridge included in the Echo repo.
              </p>
              <BridgeBuildBlock />
              <Labeled
                label={
                  <>
                    Add to <code className={INLINE_CODE}>.cursor/mcp.json</code>
                  </>
                }
              >
                <CodeBlock code={stdioConfig} />
              </Labeled>
            </TabsContent>

            <TabsContent value="codex" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                Codex CLI connects over stdio through the local bridge included in the Echo repo.
              </p>
              <BridgeBuildBlock />
              <Labeled
                label={
                  <>
                    Add to <code className={INLINE_CODE}>~/.codex/config.toml</code>
                  </>
                }
              >
                <CodeBlock code={codexConfig} />
              </Labeled>
            </TabsContent>

            <TabsContent value="chatgpt" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                In ChatGPT, enable developer mode in settings, then add a remote MCP connector pointing at your
                Echo endpoint. Authenticate with your API key as a bearer token.
              </p>
              {needsPublicConnectorUrl && (
                <Alert>
                  <CircleAlertIcon />
                  <AlertTitle>Use a publicly reachable HTTPS URL</AlertTitle>
                  <AlertDescription>
                    The current {origin} address is local or non-HTTPS and cannot be used as a remote connector
                    endpoint. Deploy Echo behind HTTPS, keep public signup disabled, and replace the example host
                    below with that deployment.
                  </AlertDescription>
                </Alert>
              )}
              <Labeled label="Connector endpoint">
                <CodeBlock code={chatGptEndpoint} />
              </Labeled>
              <Labeled label="Authorization header">
                <CodeBlock code={`Authorization: Bearer YOUR_API_KEY`} />
              </Labeled>
            </TabsContent>

            <TabsContent value="other" className="flex flex-col gap-3.5 pt-1.5">
              <p className="max-w-prose text-muted-foreground">
                Echo speaks Streamable HTTP MCP — point any compatible client at the endpoint and pass your key
                as a bearer token.
              </p>
              <Labeled label="Endpoint">
                <CodeBlock code={`${origin}/mcp`} />
              </Labeled>
              <Labeled label="Authorization header">
                <CodeBlock code={`Authorization: Bearer YOUR_API_KEY`} />
              </Labeled>
            </TabsContent>
          </Tabs>
        </Step>

        <Step
          number={3}
          title="Try it out"
          description={
            <>
              Say this in your connected app, then confirm the new memory shows up in{' '}
              <Link to="/memories" className="font-medium text-foreground underline underline-offset-4">
                Memories
              </Link>
              .
            </>
          }
        >
          <CodeBlock code="Use Echo to remember that I prefer concise answers." />
        </Step>
      </ol>

      <section className="mt-10 border-t pt-6">
        <h2 className="font-heading text-sm font-medium">What connected apps can do</h2>
        <p className="mt-0.5 text-xs/relaxed text-muted-foreground">
          Every connected app gets these five MCP tools, limited to the scopes its key can access.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {MCP_TOOLS.map((tool, i) => (
              <li key={tool.name} className="flex items-start gap-3 px-4 py-3 sm:items-center">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={solidTileStyle(CHART_COLORS[i % CHART_COLORS.length])}
                >
                  <tool.icon aria-hidden className="size-3.5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                  <code className="shrink-0 font-mono text-xs font-medium sm:w-40">{tool.name}</code>
                  <p className="text-xs/relaxed text-muted-foreground">{tool.description}</p>
                </div>
              </li>
            ))}
          </ul>
          {meta && (
            <div className="flex items-start gap-2 border-t bg-muted/20 px-4 py-2.5 text-xs/relaxed text-muted-foreground">
              <span
                className={cn(
                  'mt-1 size-2 shrink-0 rounded-full',
                  meta.embeddings ? 'bg-success' : 'bg-warning',
                )}
              />
              <span>
                {meta.embeddings ? (
                  <>
                    <code className={INLINE_CODE}>recall_context</code> runs semantic search via{' '}
                    {meta.embeddings.provider}/{meta.embeddings.model}.
                  </>
                ) : (
                  <>
                    <code className={INLINE_CODE}>recall_context</code> is keyword-only right now — set{' '}
                    <code className={INLINE_CODE}>EMBEDDINGS_PROVIDER</code> on the server to enable semantic
                    search.
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
