import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Memory, MemorySearchResult } from '@echo/shared';
import { z } from 'zod';
import { getAccessibleScopes, resolveScopeSelector } from '@/core/access';
import { createMemory, deleteMemory, listMemories, searchMemories } from '@/core/memories';
import { VERSION } from '@/config';
import { HttpError } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message);
    throw err;
  }
}

function compactMemory(m: Memory) {
  return {
    id: m.id,
    content: m.content,
    scope: `${m.scopeName} [${m.scopeType}]`,
    scope_id: m.scopeId,
    kind: m.kind,
    confidence: m.confidence,
    sensitivity: m.sensitivity,
    tags: m.tags.length > 0 ? m.tags : undefined,
    source_app: m.sourceApp,
    created_at: m.createdAt,
    expires_at: m.expiresAt ?? undefined,
  };
}

function compactResult(m: MemorySearchResult) {
  return { ...compactMemory(m), similarity: m.similarity ?? undefined };
}

/**
 * One McpServer instance per request (the HTTP transport is stateless), bound
 * to the API key's user identity. The MCP layer is deliberately thin: every
 * tool delegates to the same core functions the REST API uses, so access
 * control and audit logging are identical on both paths.
 */
export function buildMcpServer(app: AppContext, ctx: AuthContext): McpServer {
  const server = new McpServer({ name: 'echo-context', version: VERSION });

  server.tool(
    'remember_context',
    'Store a memory in Echo, the user\'s cross-app context store. Use when the user says "remember ..." (kind=explicit) or when you learn a durable, useful fact about the user, their team, or their projects (kind=inferred, with an honest confidence). Do NOT store secrets, credentials, or trivial conversational details.',
    {
      content: z.string().min(1).max(10_000).describe('The memory itself, as a self-contained statement (e.g. "Prefers TypeScript with strict mode for new projects").'),
      scope: z.string().optional().describe('Where to store it: "personal" (default), a scope name (e.g. "Acme" or "Acme/Platform Team"), or a scope id from list_scopes. Use org/team scopes only for knowledge the whole group should share.'),
      kind: z.enum(['explicit', 'inferred']).optional().describe('"explicit" if the user asked to remember this; "inferred" if you deduced it. Default explicit.'),
      confidence: z.number().min(0).max(1).optional().describe('How certain this fact is, 0-1. Use 1 for explicit user statements.'),
      sensitivity: z.enum(['low', 'normal', 'high']).optional().describe('Mark "high" for health, financial, or otherwise delicate information.'),
      tags: z.array(z.string()).max(20).optional().describe('Short lowercase topical tags, e.g. ["preferences", "tooling"].'),
      expires_in_days: z.number().int().min(1).max(3650).optional().describe('Auto-expire after N days, for facts that go stale (e.g. "currently traveling").'),
    },
    async (args) =>
      run(async () => {
        const { scope, error } = await resolveScopeSelector(app, ctx.userId, args.scope);
        if (!scope) return fail(error ?? 'No personal scope found');
        const memory = await createMemory(app, ctx, {
          content: args.content,
          scopeId: scope.id,
          kind: args.kind ?? 'explicit',
          confidence: args.confidence,
          sensitivity: args.sensitivity,
          tags: args.tags,
          expiresAt: args.expires_in_days
            ? new Date(Date.now() + args.expires_in_days * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
        });
        return ok({ stored: true, memory: compactMemory(memory) });
      }),
  );

  server.tool(
    'recall_context',
    'Search the user\'s Echo memories semantically. Call this at the start of a task to pull in relevant context about the user, their preferences, their team, or the project — e.g. recall_context("database conventions") before writing SQL.',
    {
      query: z.string().min(1).max(1000).describe('Natural-language description of what context you need.'),
      scope: z.string().optional().describe('Restrict to one scope by name or id. Default: all scopes the user can access.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results, default 8.'),
    },
    async (args) =>
      run(async () => {
        let scopeIds: string[] | undefined;
        if (args.scope) {
          const { scope, error } = await resolveScopeSelector(app, ctx.userId, args.scope);
          if (!scope) return fail(error ?? 'Scope not found');
          scopeIds = [scope.id];
        }
        const { results, mode } = await searchMemories(app, ctx, {
          query: args.query,
          scopeIds,
          limit: args.limit,
        });
        return ok({ mode, count: results.length, results: results.map(compactResult) });
      }),
  );

  server.tool(
    'list_context',
    'List the user\'s Echo memories chronologically (newest first). Useful for browsing what is stored; prefer recall_context for finding relevant facts.',
    {
      scope: z.string().optional().describe('Scope name or id. Default: all accessible scopes.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results, default 25.'),
      offset: z.number().int().min(0).optional(),
    },
    async (args) =>
      run(async () => {
        let scopeId: string | undefined;
        if (args.scope) {
          const { scope, error } = await resolveScopeSelector(app, ctx.userId, args.scope);
          if (!scope) return fail(error ?? 'Scope not found');
          scopeId = scope.id;
        }
        const { memories, total } = await listMemories(app, ctx, {
          scopeId,
          limit: Math.min(args.limit ?? 25, 100),
          offset: args.offset,
        });
        return ok({ total, count: memories.length, memories: memories.map(compactMemory) });
      }),
  );

  server.tool(
    'forget_context',
    'Delete a memory from Echo by id. Use when the user asks to forget something or when a stored fact is clearly wrong or obsolete. Find the id via recall_context or list_context first.',
    {
      memory_id: z.string().uuid().describe('The id of the memory to delete.'),
    },
    async (args) =>
      run(async () => {
        await deleteMemory(app, ctx, args.memory_id);
        return ok({ deleted: true, memory_id: args.memory_id });
      }),
  );

  server.tool(
    'list_scopes',
    'List the scopes (personal / organization / team / project / workspace) this user can read and write, with memory counts. Use to decide where remember_context should store shared knowledge.',
    {},
    async () =>
      run(async () => {
        const scopes = await getAccessibleScopes(app, ctx.userId);
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

  return server;
}
