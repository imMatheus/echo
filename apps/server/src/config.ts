import { z } from 'zod';

export const VERSION = '0.1.0';

const boolString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('postgres://echo:echo@localhost:5433/echo'),
  // 3246 spells ECHO on a phone keypad — and stays clear of crowded dev ports
  // like 8787 (wrangler and friends).
  PORT: z.coerce.number().int().positive().default(3246),
  HOST: z.string().default('0.0.0.0'),
  /** Public URL of this deployment; used to mark session cookies Secure when https. */
  APP_URL: z.string().optional(),
  DISABLE_SIGNUP: boolString.default('false'),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  EMBEDDINGS_PROVIDER: z.enum(['none', 'openai', 'voyage', 'ollama']).default('none'),
  EMBEDDINGS_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  VOYAGE_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  LOG_LEVEL: z.string().default('info'),
  /** Override where the built dashboard is served from. */
  STATIC_DIR: z.string().optional(),
  TRUST_PROXY: boolString.default('false'),
});

export type Config = z.infer<typeof EnvSchema> & { secureCookies: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // docker-compose passthroughs like `FOO: ${FOO:-}` arrive as empty strings — treat them as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.EMBEDDINGS_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) {
    throw new Error('EMBEDDINGS_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (cfg.EMBEDDINGS_PROVIDER === 'voyage' && !cfg.VOYAGE_API_KEY) {
    throw new Error('EMBEDDINGS_PROVIDER=voyage requires VOYAGE_API_KEY');
  }
  return { ...cfg, secureCookies: cfg.APP_URL?.startsWith('https://') ?? false };
}
