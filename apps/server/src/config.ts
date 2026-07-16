import { z } from 'zod';

export const VERSION = '0.1.0';

const DEVELOPMENT_AUTH_TOKEN_SECRET = 'echo-development-auth-token-secret-change-before-deploying';
const DEFAULT_DATABASE_URL = 'postgres://echo:echo@localhost:5433/echo';
const EMAIL_FROM_PATTERN = /^(?:[^<>\r\n]+\s)?<([^<>\r\n]+)>$/;

function isEmailAddress(value: string): boolean {
  return z.string().email().safeParse(value).success;
}

function isEmailFrom(value: string): boolean {
  const displayAddress = EMAIL_FROM_PATTERN.exec(value)?.[1];
  return isEmailAddress(displayAddress ?? value);
}

const boolString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  /** Generic application database connection URL. */
  DATABASE_URL: z.string().trim().min(1).default(DEFAULT_DATABASE_URL),
  /** Exact browser dashboard origin permitted to make credentialed API requests. */
  WEB_ORIGIN: z.string().trim().url().default('http://localhost:5173'),
  /** `none` is required only when web and API are on different sites. */
  COOKIE_SAME_SITE: z.enum(['lax', 'none']).default('lax'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  /** Public URL of this deployment; used to mark session cookies Secure when https. */
  APP_URL: z.string().trim().url().optional(),
  DISABLE_SIGNUP: boolString.default('false'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  EMAIL_FROM: z
    .string()
    .trim()
    .refine(isEmailFrom, 'must be an email address or `Display name <email@example.com>`')
    .default('Echo <onboarding@resend.dev>'),
  EMAIL_REPLY_TO: z.string().trim().email().optional(),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  AUTH_TOKEN_SECRET: z.string().min(32).default(DEVELOPMENT_AUTH_TOKEN_SECRET),
  EMBEDDINGS_PROVIDER: z.enum(['none', 'openai', 'voyage', 'ollama']).default('none'),
  EMBEDDINGS_MODEL: z.string().trim().min(1).optional(),
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_BASE_URL: z.string().trim().url().default('https://api.openai.com/v1'),
  VOYAGE_API_KEY: z.string().trim().min(1).optional(),
  OLLAMA_URL: z.string().trim().url().default('http://localhost:11434'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Override where the built dashboard is served from. */
  STATIC_DIR: z.string().trim().min(1).optional(),
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
  const webOrigin = new URL(cfg.WEB_ORIGIN).origin;
  if (cfg.EMBEDDINGS_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) {
    throw new Error('EMBEDDINGS_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (cfg.EMBEDDINGS_PROVIDER === 'voyage' && !cfg.VOYAGE_API_KEY) {
    throw new Error('EMBEDDINGS_PROVIDER=voyage requires VOYAGE_API_KEY');
  }
  if (cfg.EMAIL_PROVIDER === 'resend' && !cfg.RESEND_API_KEY) {
    throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY');
  }
  if (cfg.EMAIL_PROVIDER === 'resend' && !cfg.APP_URL) {
    throw new Error('EMAIL_PROVIDER=resend requires APP_URL so authentication links point to your app');
  }
  if (cfg.EMAIL_PROVIDER === 'resend' && cfg.AUTH_TOKEN_SECRET === DEVELOPMENT_AUTH_TOKEN_SECRET) {
    throw new Error('EMAIL_PROVIDER=resend requires a unique AUTH_TOKEN_SECRET of at least 32 characters');
  }
  const secureCookies = cfg.APP_URL ? new URL(cfg.APP_URL).protocol.toLowerCase() === 'https:' : false;
  if (secureCookies && cfg.AUTH_TOKEN_SECRET === DEVELOPMENT_AUTH_TOKEN_SECRET) {
    throw new Error('HTTPS APP_URL requires a unique AUTH_TOKEN_SECRET of at least 32 characters');
  }
  if (secureCookies && cfg.EMAIL_PROVIDER === 'console') {
    throw new Error('HTTPS APP_URL requires a production EMAIL_PROVIDER');
  }
  if (cfg.COOKIE_SAME_SITE === 'none' && !secureCookies) {
    throw new Error('COOKIE_SAME_SITE=none requires an HTTPS APP_URL');
  }
  return {
    ...cfg,
    WEB_ORIGIN: webOrigin,
    secureCookies,
  };
}
