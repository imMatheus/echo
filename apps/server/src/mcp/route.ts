import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@/types';
import { requireApiKeyAuth } from '@/http/authn';
import { buildMcpServer } from './tools';

function jsonRpcError(reply: FastifyReply, status: number, code: number, message: string): void {
  reply.code(status).send({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Stateless streamable-HTTP MCP endpoint: every POST builds a fresh
 * server+transport pair bound to the caller's API key. No session state means
 * horizontal scaling works and GET/DELETE (SSE session management) are not
 * needed.
 */
export function mcpRoutes(app: AppContext) {
  return async function routes(f: FastifyInstance) {
    f.post('/mcp', async (req, reply) => {
      const ctx = await requireApiKeyAuth(app, req);
      if (!ctx) {
        reply.header('www-authenticate', 'Bearer realm="echo", error="invalid_token"');
        return jsonRpcError(reply, 401, -32001, 'Unauthorized: pass an Echo API key as "Authorization: Bearer eck_..."');
      }

      const server = buildMcpServer(app, ctx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      reply.hijack();
      req.raw.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } catch (err) {
        app.log.error({ err }, 'mcp request failed');
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(
            JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }),
          );
        } else {
          reply.raw.end();
        }
      }
    });

    const methodNotAllowed = async (_req: unknown, reply: FastifyReply) => {
      reply.header('allow', 'POST');
      jsonRpcError(reply, 405, -32000, 'Method not allowed: this MCP endpoint is stateless, use POST');
    };
    f.get('/mcp', methodNotAllowed);
    f.delete('/mcp', methodNotAllowed);
  };
}
