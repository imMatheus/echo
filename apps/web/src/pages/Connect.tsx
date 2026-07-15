import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BookmarkPlusIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  LayersIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ApiKeyInfo } from '@echo/shared';
import * as api from '@/api';
import { errorMessage } from '@/api';
import { useApiKeys, useMeta } from '@/hooks';
import { SourceChip } from '@/components/Badge';
import { CodeBlock } from '@/components/CodeBlock';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { RelativeTime } from '@/components/RelativeTime';
import { RequestErrorState } from '@/components/RequestErrorState';
import { TableSkeleton } from '@/components/Skeletons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const { data: keys, error, mutate } = useApiKeys();

  // Which client the setup snippets target — lifted to state so we can prefill
  // a new key's source app and adapt the step-2 copy.
  const [client, setClient] = useState('claude-code');
  const [showCreate, setShowCreate] = useState(false);
  // The freshly-created key. Its secret is shown only once, so it lives here for
  // the rest of the session and is injected into the snippets below.
  const [generated, setGenerated] = useState<{ name: string; secret: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const origin = window.location.origin;
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
  const needsPublicConnectorUrl =
    window.location.protocol !== 'https:' || localHostnames.has(window.location.hostname);
  const chatGptEndpoint = needsPublicConnectorUrl
    ? 'https://your-public-echo.example.com/mcp'
    : `${origin}/mcp`;

  // PlanetScale-style: once a key is generated its real value is dropped straight
  // into every copy-paste snippet; otherwise we show the placeholder to edit.
  const apiKey = generated?.secret ?? 'YOUR_API_KEY';
  const hasKey = generated !== null;

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        echo: {
          command: 'node',
          args: [BRIDGE_PATH],
          env: {
            ECHO_URL: origin,
            ECHO_API_KEY: apiKey,
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
    `env = { ECHO_URL = "${origin}", ECHO_API_KEY = "${apiKey}" }`,
  ].join('\n');

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeApiKey(revokeTarget.id);
      toast.success(`Revoked “${revokeTarget.name}”`);
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div>
      <PageHeader
        title="Connect"
        subtitle="Give Claude, Cursor, or any MCP client a shared memory on this Echo server — create a key, drop it into your app, and you're connected."
      />

      <ol>
        <Step
          number={1}
          title="Create your API key"
          description="Every connected app authenticates with a bearer key. Generate one here — it's dropped straight into the setup snippet in the next step."
        >
          {generated ? (
            <div className="flex flex-col gap-3">
              <Alert className="border-warning/40 text-warning">
                <TriangleAlertIcon />
                <AlertTitle>Copy your key now</AlertTitle>
                <AlertDescription className="text-warning/90">
                  This is the only time the full key is shown. It's already filled into the setup snippet
                  below — copy that, or grab the raw key here. Echo keeps only a hashed version.
                </AlertDescription>
              </Alert>
              <Labeled
                label={
                  <>
                    Key for <span className="font-medium text-foreground">{generated.name}</span>
                  </>
                }
              >
                <CodeBlock code={generated.secret} />
              </Labeled>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="self-start text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Generate another key
              </button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowCreate(true)}>
              <KeyRoundIcon data-icon="inline-start" />
              Generate API key
            </Button>
          )}
        </Step>

        <Step
          number={2}
          title="Add Echo to your app"
          description={
            hasKey ? (
              <>
                Pick your app below — your new key is already filled into each snippet. For stdio clients,
                replace <code className={INLINE_CODE}>/absolute/path/to/echo</code> with your checkout's
                absolute path.
              </>
            ) : (
              <>
                Pick your app below, then replace <code className={INLINE_CODE}>YOUR_API_KEY</code> with the
                key from step 1. For stdio clients, also replace{' '}
                <code className={INLINE_CODE}>/absolute/path/to/echo</code> with your checkout's absolute path.
              </>
            )
          }
        >
          <Tabs value={client} onValueChange={(value) => setClient(value as string)}>
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
                code={`claude mcp add --transport http echo ${origin}/mcp --header "Authorization: Bearer ${apiKey}"`}
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
                <CodeBlock code={`Authorization: Bearer ${apiKey}`} />
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
                <CodeBlock code={`Authorization: Bearer ${apiKey}`} />
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
        <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-card">
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

      <section className="mt-10 border-t pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-sm font-medium">Your API keys</h2>
            <p className="mt-0.5 max-w-prose text-xs/relaxed text-muted-foreground">
              Every key here can read and write your memories over MCP. Revoke any you no longer use — apps
              using it lose access immediately.
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            Create key
          </Button>
        </div>

        <div className="mt-4">
          {!keys && error ? (
            <RequestErrorState error={error} onRetry={() => mutate()} />
          ) : !keys ? (
            <TableSkeleton rows={3} />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<KeyRoundIcon />}
              title="No API keys"
              description="Create a key to connect Claude, Cursor, or any MCP client to your Echo memories."
              action={
                <Button onClick={() => setShowCreate(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Create key
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Source app</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => {
                    const revoked = key.revokedAt !== null;
                    return (
                      <TableRow key={key.id} className={cn(revoked && 'opacity-60')}>
                        <TableCell className="font-semibold">{key.name}</TableCell>
                        <TableCell>
                          <SourceChip app={key.sourceApp} />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{key.keyPrefix}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <RelativeTime date={key.createdAt} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {key.lastUsedAt ? <RelativeTime date={key.lastUsedAt} /> : 'Never'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={revoked ? 'secondary' : 'outline'}
                            className={cn(!revoked && 'border-success/35 bg-success/10 text-success')}
                          >
                            {revoked ? 'revoked' : 'active'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {!revoked && (
                            <Button variant="destructive" size="sm" onClick={() => setRevokeTarget(key)}>
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      {showCreate && (
        <CreateKeyModal
          defaultSourceApp={client === 'other' ? '' : client}
          onClose={() => setShowCreate(false)}
          onCreated={(name, secret) => {
            setShowCreate(false);
            setGenerated({ name, secret });
            toast.success(`Created “${name}” — copy the key now, it won't be shown again.`);
            void mutate();
          }}
        />
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke API key?"
          message={
            <>
              Apps using <strong>{revokeTarget.name}</strong> ({revokeTarget.keyPrefix}) will immediately lose
              access. This cannot be undone.
            </>
          }
          confirmLabel="Revoke key"
          onConfirm={revoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

function CreateKeyModal({
  defaultSourceApp = '',
  onClose,
  onCreated,
}: {
  defaultSourceApp?: string;
  onClose: () => void;
  onCreated: (name: string, secret: string) => void;
}) {
  const [name, setName] = useState('');
  const [sourceApp, setSourceApp] = useState(defaultSourceApp);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setPending(true);
    try {
      const res = await api.createApiKey({
        name: name.trim(),
        sourceApp: sourceApp.trim() || undefined,
      });
      onCreated(res.key.name, res.secret);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      disablePointerDismissal={pending}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Laptop — Claude Code"
                autoFocus
                required
                maxLength={100}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="key-source">Source app</FieldLabel>
              <Input
                id="key-source"
                value={sourceApp}
                onChange={(e) => setSourceApp(e.target.value)}
                placeholder="claude-code, cursor, chatgpt…"
                maxLength={64}
              />
              <FieldDescription>Label attached to memories written with this key.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
