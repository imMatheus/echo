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

const ECHO_URL = (process.env.ECHO_URL ?? '').replace(/\/+$/, '');
const ECHO_API_KEY = process.env.ECHO_API_KEY ?? '';

if (!ECHO_URL || !ECHO_API_KEY) {
  console.error('echo-context-mcp: set ECHO_URL and ECHO_API_KEY environment variables');
  process.exit(1);
}

class EchoApiError extends Error {}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${ECHO_URL}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ECHO_API_KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    throw new EchoApiError(json?.error?.message ?? `Echo API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

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
    return fail(`Could not reach the Echo server at ${ECHO_URL}: ${(err as Error).message}`);
  }
}

interface ScopeInfo {
  id: string;
  type: string;
  name: string;
  orgName: string | null;
  memoryCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the server-side selector: "personal" | scope id | (org-qualified) scope name. */
async function resolveScope(selector: string | undefined): Promise<{ id: string } | { error: string }> {
  const { scopes } = (await api('GET', '/scopes')) as { scopes: ScopeInfo[] };
  if (!selector || selector.toLowerCase() === 'personal') {
    const personal = scopes.find((s) => s.type === 'personal');
    return personal ? { id: personal.id } : { error: 'No personal scope found' };
  }
  if (UUID_RE.test(selector)) {
    const hit = scopes.find((s) => s.id === selector);
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

function compact(m: any) {
  return {
    id: m.id,
    content: m.content,
    scope: `${m.scopeName} [${m.scopeType}]`,
    scope_id: m.scopeId,
    kind: m.kind,
    confidence: m.confidence,
    sensitivity: m.sensitivity,
    tags: m.tags?.length ? m.tags : undefined,
    source_app: m.sourceApp,
    created_at: m.createdAt,
    expires_at: m.expiresAt ?? undefined,
    similarity: m.similarity ?? undefined,
  };
}

const server = new McpServer({ name: 'echo-context', version: '0.1.0' });

server.tool(
  'remember_context',
  'Store a memory in Echo, the user\'s cross-app context store. Use when the user says "remember ..." (kind=explicit) or when you learn a durable, useful fact about the user, their team, or their projects (kind=inferred, with an honest confidence). Do NOT store secrets, credentials, or trivial conversational details.',
  {
    content: z.string().min(1).max(10_000).describe('The memory itself, as a self-contained statement.'),
    scope: z.string().optional().describe('"personal" (default), a scope name (e.g. "Acme/Platform Team"), or a scope id from list_scopes.'),
    kind: z.enum(['explicit', 'inferred']).optional().describe('"explicit" if the user asked to remember this; "inferred" if you deduced it.'),
    confidence: z.number().min(0).max(1).optional().describe('How certain this fact is, 0-1.'),
    sensitivity: z.enum(['low', 'normal', 'high']).optional(),
    tags: z.array(z.string()).max(20).optional().describe('Short lowercase topical tags.'),
    expires_in_days: z.number().int().min(1).max(3650).optional().describe('Auto-expire after N days.'),
  },
  async (args) =>
    run(async () => {
      const resolved = await resolveScope(args.scope);
      if ('error' in resolved) return fail(resolved.error);
      const { memory } = await api('POST', '/memories', {
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
  'Search the user\'s Echo memories semantically. Call this at the start of a task to pull in relevant context about the user, their preferences, their team, or the project.',
  {
    query: z.string().min(1).max(1000).describe('Natural-language description of what context you need.'),
    scope: z.string().optional().describe('Restrict to one scope by name or id. Default: all accessible scopes.'),
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
      const { results, mode } = await api('POST', '/memories/search', {
        query: args.query,
        scopeIds,
        limit: args.limit,
      });
      return ok({ mode, count: results.length, results: results.map(compact) });
    }),
);

server.tool(
  'list_context',
  'List the user\'s Echo memories chronologically (newest first). Prefer recall_context for finding relevant facts.',
  {
    scope: z.string().optional().describe('Scope name or id. Default: all accessible scopes.'),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
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
      const { memories, total } = await api('GET', `/memories?${params}`);
      return ok({ total, count: memories.length, memories: memories.map(compact) });
    }),
);

server.tool(
  'forget_context',
  'Delete a memory from Echo by id. Use when the user asks to forget something or a stored fact is wrong or obsolete.',
  {
    memory_id: z.string().uuid().describe('The id of the memory to delete.'),
  },
  async (args) =>
    run(async () => {
      await api('DELETE', `/memories/${args.memory_id}`);
      return ok({ deleted: true, memory_id: args.memory_id });
    }),
);

server.tool(
  'list_scopes',
  'List the scopes (personal / organization / team / project / workspace) this user can read and write, with memory counts.',
  {},
  async () =>
    run(async () => {
      const { scopes } = (await api('GET', '/scopes')) as { scopes: ScopeInfo[] };
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
