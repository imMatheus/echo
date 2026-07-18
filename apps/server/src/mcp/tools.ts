import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Memory, MemorySearchResult } from '@echo/shared';
import { z } from 'zod';
import { getAccessibleScopes, resolveScopeSelector } from '@/core/access';
import { createMemory, deleteMemory, listMemories, searchMemories } from '@/core/memories';
import { VERSION } from '@/config';
import { HttpError } from '@/lib/http-error';
import type { AppContext, AuthContext } from '@/types';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const scopeSelector = z.string().trim().min(1).max(201);

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export async function runTool(app: AppContext, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message);
    // Mirror the REST error handler: an unexpected error must be logged
    // server-side and surfaced as a generic message. Rethrowing instead lets
    // the MCP SDK swallow it into a tool error carrying the raw internal
    // message, so operators lose the error and clients see internal detail.
    app.log.error({ err }, 'mcp tool failed');
    return fail('Internal error');
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
    'Store a durable fact in Echo so it can be recalled across conversations and AI apps. Call this when the user explicitly asks to remember or save something, or when a stable, useful fact about the user, their preferences, team, or project would clearly improve future work. Use kind="explicit" for facts the user stated or asked to save; use kind="inferred" only for genuine deductions and record an honest confidence. Do not store secrets, credentials, sensitive authentication data, unsupported guesses, or trivial and short-lived conversation details; default to the personal scope unless shared team or organization context is clearly intended.',
    {
      content: z
        .string()
        .trim()
        .min(1)
        .max(10_000)
        .describe(
          'The memory itself, as a self-contained statement (e.g. "Prefers TypeScript with strict mode for new projects").',
        ),
      scope: scopeSelector
        .optional()
        .describe(
          'Where to store it: "personal" (default), a scope name (e.g. "Acme" or "Acme/Platform Team"), or a scope id from list_scopes. Use org/team scopes only for knowledge the whole group should share.',
        ),
      kind: z
        .enum(['explicit', 'inferred'])
        .optional()
        .describe('"explicit" if the user asked to remember this; "inferred" if you deduced it. Default explicit.'),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('How certain this fact is, 0-1. Use 1 for explicit user statements.'),
      sensitivity: z
        .enum(['low', 'normal', 'high'])
        .optional()
        .describe('Mark "high" for health, financial, or otherwise delicate information.'),
      tags: z
        .array(z.string().trim().min(1).max(64))
        .max(20)
        .optional()
        .describe('Short topical tags, normalized to lowercase (e.g. ["preferences", "tooling"]).'),
      expires_in_days: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .optional()
        .describe('Auto-expire after N days, for facts that go stale (e.g. "currently traveling").'),
    },
    async (args) =>
      runTool(app, async () => {
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
    'Search Echo for relevant stored context. Call this before answering any question whose answer may depend on user-specific facts, including identity, relationships, location, preferences, personal history, prior decisions, team knowledge, or project conventions; also call it at the start of a task when saved context could change the result. Use a focused natural-language query describing the facts you need, and prefer this tool over list_context for targeted lookup. Treat an empty result as "no matching memory found," not proof that the fact is false, and do not invent details beyond the returned memories.',
    {
      query: z.string().trim().min(1).max(1000).describe('Natural-language description of what context you need.'),
      scope: scopeSelector
        .optional()
        .describe('Restrict to one scope by name or id. Default: all scopes the user can access.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results, default 8.'),
    },
    async (args) =>
      runTool(app, async () => {
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
    'Browse Echo memories chronologically, newest first, with optional scope filtering and pagination. Call this when the user asks what Echo knows, wants to review recent or all stored memories, or when a targeted recall is insufficient and chronological browsing is needed. Prefer recall_context for finding a specific fact; avoid listing broad personal context when a narrower search would answer the request.',
    {
      scope: scopeSelector.optional().describe('Scope name or id. Default: all accessible scopes.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results, default 25.'),
      offset: z.number().int().min(0).max(100_000).optional(),
    },
    async (args) =>
      runTool(app, async () => {
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
    'Permanently delete one Echo memory by its exact id. Call this only when the user explicitly asks Echo to forget or delete a stored fact, including when they say a memory is wrong or obsolete; first use recall_context or list_context to identify the exact memory and disambiguate if multiple entries could match. Never delete additional related memories by inference, and do not use this tool merely because a recalled memory seems irrelevant to the current task.',
    {
      memory_id: z.string().uuid().describe('The id of the memory to delete.'),
    },
    async (args) =>
      runTool(app, async () => {
        await deleteMemory(app, ctx, args.memory_id);
        return ok({ deleted: true, memory_id: args.memory_id });
      }),
  );

  server.tool(
    'list_scopes',
    'List every Echo scope the user can access, including personal, organization, workspace, team, and project scopes, with opaque ids and memory counts. Call this when the user asks about available scopes or when remember_context needs a shared destination whose exact name or id is unknown or ambiguous. It is usually unnecessary for personal-memory writes or searches across all accessible scopes; copy returned scope ids exactly and never guess them.',
    {},
    async () =>
      runTool(app, async () => {
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
