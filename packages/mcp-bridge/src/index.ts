#!/usr/bin/env node
/**
 * echo-context-mcp — stdio ⇄ Echo bridge.
 *
 * Exposes Echo's context tools to MCP clients that only speak local stdio
 * (Claude Desktop, older Cursor builds, ...) by forwarding every tool call to
 * a remote Echo server's REST API.
 *
 * Config (env):
 *   ECHO_URL      base URL of the Echo server, e.g. https://echo.example.com
 *   ECHO_API_KEY  an Echo API key (create one in the dashboard under API Keys)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 30_000;
const ECHO_URL_VALUE = (process.env.ECHO_URL ?? '').trim();
const ECHO_API_KEY = (process.env.ECHO_API_KEY ?? '').trim();

if (!ECHO_URL_VALUE || !ECHO_API_KEY) {
  console.error('echo-context-mcp: set ECHO_URL and ECHO_API_KEY environment variables');
  process.exit(1);
}
if (!/^eck_\S+$/.test(ECHO_API_KEY)) {
  console.error('echo-context-mcp: ECHO_API_KEY must be a whitespace-free Echo key beginning with "eck_"');
  process.exit(1);
}

let parsedEchoUrl: URL;
try {
  parsedEchoUrl = new URL(ECHO_URL_VALUE);
} catch {
  console.error('echo-context-mcp: ECHO_URL must be a valid HTTP(S) URL');
  process.exit(1);
}
if (!['http:', 'https:'].includes(parsedEchoUrl.protocol)) {
  console.error('echo-context-mcp: ECHO_URL must use http:// or https://');
  process.exit(1);
}
if (
  parsedEchoUrl.username ||
  parsedEchoUrl.password ||
  parsedEchoUrl.href.includes('?') ||
  parsedEchoUrl.href.includes('#')
) {
  console.error('echo-context-mcp: ECHO_URL must not contain credentials, a query string, or a fragment');
  process.exit(1);
}
const ECHO_URL = parsedEchoUrl.toString().replace(/\/+$/, '');

class EchoApiError extends Error {}

const errorResponseSchema = z.object({ error: z.object({ message: z.string() }) });

const scopeInfoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  name: z.string(),
  orgName: z.string().nullable(),
  memoryCount: z.number().int().nonnegative(),
});

const memoryInfoSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  scopeId: z.string().uuid(),
  scopeType: z.string(),
  scopeName: z.string(),
  kind: z.string(),
  confidence: z.number(),
  sensitivity: z.string(),
  tags: z.array(z.string()),
  sourceApp: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  similarity: z.number().nullable().optional(),
});
type MemoryInfo = z.infer<typeof memoryInfoSchema>;

const scopesResponseSchema = z.object({ scopes: z.array(scopeInfoSchema) });
const memoryResponseSchema = z.object({ memory: memoryInfoSchema });
const searchResponseSchema = z.object({
  results: z.array(memoryInfoSchema),
  mode: z.enum(['hybrid', 'fts']),
});
const listResponseSchema = z.object({
  memories: z.array(memoryInfoSchema),
  total: z.number().int().nonnegative(),
});
const okResponseSchema = z.object({ ok: z.boolean() });

type HttpMethod = 'GET' | 'POST' | 'DELETE';

async function api<T>(method: HttpMethod, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${ECHO_URL}/api/v1${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${ECHO_API_KEY}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new EchoApiError(`Echo request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const error = errorResponseSchema.safeParse(json);
    throw new EchoApiError(error.success ? error.data.error.message : `Echo API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new EchoApiError(`Echo returned an invalid response for ${method} ${path}`);
  }
  return parsed.data;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
// Organization and nested-scope names are each capped at 100 characters;
// include the separating slash for a fully qualified selector.
const scopeSelector = nonBlank(201);
const tags = z.array(nonBlank(64)).max(20);

const ok = (payload: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});

async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EchoApiError) return fail(err.message);
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Could not reach the Echo server at ${ECHO_URL}: ${message}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the server-side selector: "personal" | scope id | (org-qualified) scope name. */
async function resolveScope(selector: string | undefined): Promise<{ id: string } | { error: string }> {
  const { scopes } = await api('GET', '/scopes', scopesResponseSchema);
  if (!selector || selector.toLowerCase() === 'personal') {
    const personal = scopes.find((s) => s.type === 'personal');
    return personal ? { id: personal.id } : { error: 'No personal scope found' };
  }
  if (UUID_RE.test(selector)) {
    const normalizedId = selector.toLowerCase();
    const hit = scopes.find((s) => s.id === normalizedId);
    return hit ? { id: hit.id } : { error: `No accessible scope with id ${selector}` };
  }
  const needle = selector.toLowerCase();
  const matches = scopes.filter(
    (s) => s.name.toLowerCase() === needle || `${(s.orgName ?? '').toLowerCase()}/${s.name.toLowerCase()}` === needle,
  );
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length > 1) return { error: `Scope name "${selector}" is ambiguous — use the id from list_scopes` };
  return {
    error: `No accessible scope named "${selector}". Available: ${scopes
      .map((s) => `${s.orgName ? `${s.orgName}/` : ''}${s.name} [${s.type}]`)
      .join(', ')}`,
  };
}

function compact(m: MemoryInfo) {
  return {
    id: m.id,
    content: m.content,
    scope: `${m.scopeName} [${m.scopeType}]`,
    scope_id: m.scopeId,
    kind: m.kind,
    confidence: m.confidence,
    sensitivity: m.sensitivity,
    tags: m.tags.length ? m.tags : undefined,
    source_app: m.sourceApp,
    created_at: m.createdAt,
    expires_at: m.expiresAt ?? undefined,
    similarity: m.similarity ?? undefined,
  };
}

const server = new McpServer({ name: 'echo-context', version: '0.1.0' });

server.tool(
  'remember_context',
  'Store a durable fact in Echo so it can be recalled across conversations and AI apps. Call this when the user explicitly asks to remember or save something, or when a stable, useful fact about the user, their preferences, team, or project would clearly improve future work. Use kind="explicit" for facts the user stated or asked to save; use kind="inferred" only for genuine deductions and record an honest confidence. Do not store secrets, credentials, sensitive authentication data, unsupported guesses, or trivial and short-lived conversation details; default to the personal scope unless shared team or organization context is clearly intended.',
  {
    content: nonBlank(10_000).describe('The memory itself, as a self-contained statement.'),
    scope: scopeSelector.optional().describe('"personal" (default), a scope name (e.g. "Acme/Platform Team"), or a scope id from list_scopes.'),
    kind: z.enum(['explicit', 'inferred']).optional().describe('"explicit" if the user asked to remember this; "inferred" if you deduced it.'),
    confidence: z.number().min(0).max(1).optional().describe('How certain this fact is, 0-1.'),
    sensitivity: z.enum(['low', 'normal', 'high']).optional(),
    tags: tags.optional().describe('Short topical tags, normalized to lowercase by Echo.'),
    expires_in_days: z.number().int().min(1).max(3650).optional().describe('Auto-expire after N days.'),
  },
  async (args) =>
    run(async () => {
      const resolved = await resolveScope(args.scope);
      if ('error' in resolved) return fail(resolved.error);
      const { memory } = await api('POST', '/memories', memoryResponseSchema, {
        content: args.content,
        scopeId: resolved.id,
        kind: args.kind ?? 'explicit',
        confidence: args.confidence,
        sensitivity: args.sensitivity,
        tags: args.tags,
        expiresAt: args.expires_in_days
          ? new Date(Date.now() + args.expires_in_days * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      });
      return ok({ stored: true, memory: compact(memory) });
    }),
);

server.tool(
  'recall_context',
  'Search Echo for relevant stored context. Call this before answering any question whose answer may depend on user-specific facts, including identity, relationships, location, preferences, personal history, prior decisions, team knowledge, or project conventions; also call it at the start of a task when saved context could change the result. Use a focused natural-language query describing the facts you need, and prefer this tool over list_context for targeted lookup. Treat an empty result as "no matching memory found," not proof that the fact is false, and do not invent details beyond the returned memories.',
  {
    query: nonBlank(1000).describe('Natural-language description of what context you need.'),
    scope: scopeSelector.optional().describe('Restrict to one scope by name or id. Default: all accessible scopes.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results, default 8.'),
  },
  async (args) =>
    run(async () => {
      let scopeIds: string[] | undefined;
      if (args.scope) {
        const resolved = await resolveScope(args.scope);
        if ('error' in resolved) return fail(resolved.error);
        scopeIds = [resolved.id];
      }
      const { results, mode } = await api('POST', '/memories/search', searchResponseSchema, {
        query: args.query,
        scopeIds,
        limit: args.limit,
      });
      return ok({ mode, count: results.length, results: results.map(compact) });
    }),
);

server.tool(
  'list_context',
  'Browse Echo memories chronologically, newest first, with optional scope filtering and pagination. Call this when the user asks what Echo knows, wants to review recent or all stored memories, or when a targeted recall is insufficient and chronological browsing is needed. Prefer recall_context for finding a specific fact; avoid listing broad personal context when a narrower search would answer the request.',
  {
    scope: scopeSelector.optional().describe('Scope name or id. Default: all accessible scopes.'),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(100_000).optional().describe('Pagination offset, maximum 100000.'),
  },
  async (args) =>
    run(async () => {
      const params = new URLSearchParams();
      if (args.scope) {
        const resolved = await resolveScope(args.scope);
        if ('error' in resolved) return fail(resolved.error);
        params.set('scopeId', resolved.id);
      }
      params.set('limit', String(Math.min(args.limit ?? 25, 100)));
      if (args.offset) params.set('offset', String(args.offset));
      const { memories, total } = await api('GET', `/memories?${params}`, listResponseSchema);
      return ok({ total, count: memories.length, memories: memories.map(compact) });
    }),
);

server.tool(
  'forget_context',
  'Permanently delete one Echo memory by its exact id. Call this only when the user explicitly asks Echo to forget or delete a stored fact, including when they say a memory is wrong or obsolete; first use recall_context or list_context to identify the exact memory and disambiguate if multiple entries could match. Never delete additional related memories by inference, and do not use this tool merely because a recalled memory seems irrelevant to the current task.',
  {
    memory_id: z.string().uuid().describe('The id of the memory to delete.'),
  },
  async (args) =>
    run(async () => {
      await api('DELETE', `/memories/${args.memory_id}`, okResponseSchema);
      return ok({ deleted: true, memory_id: args.memory_id });
    }),
);

server.tool(
  'list_scopes',
  'List every Echo scope the user can access, including personal, organization, workspace, team, and project scopes, with opaque ids and memory counts. Call this when the user asks about available scopes or when remember_context needs a shared destination whose exact name or id is unknown or ambiguous. It is usually unnecessary for personal-memory writes or searches across all accessible scopes; copy returned scope ids exactly and never guess them.',
  {},
  async () =>
    run(async () => {
      const { scopes } = await api('GET', '/scopes', scopesResponseSchema);
      return ok({
        scopes: scopes.map((s) => ({
          id: s.id,
          name: s.orgName && s.type !== 'organization' ? `${s.orgName}/${s.name}` : s.name,
          type: s.type,
          organization: s.orgName ?? undefined,
          memories: s.memoryCount,
        })),
      });
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`echo-context-mcp connected to ${ECHO_URL}`);
