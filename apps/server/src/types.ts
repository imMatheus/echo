import type { Db } from './db.js';
import type { Config } from './config.js';
import type { EmbeddingProvider } from './lib/embeddings.js';
import type { FastifyBaseLogger } from 'fastify';

/** Resolved identity for a request, whether it arrived via session cookie or API key. */
export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  via: 'session' | 'api_key';
  /** Set when authenticated with an API key. */
  apiKeyId: string | null;
  /** Default provenance label for writes ("dashboard" or the API key's source app). */
  sourceApp: string;
}

/** Application-wide services threaded through route handlers and MCP tools. */
export interface AppContext {
  db: Db;
  config: Config;
  embeddings: EmbeddingProvider | null;
  log: FastifyBaseLogger | Console;
}
