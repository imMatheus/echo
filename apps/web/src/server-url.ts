/**
 * The dashboard is intentionally independent from the API deployment. Set
 * VITE_SERVER_URL to the public HTTP origin of the Echo server (no /api path).
 */
function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  // In a browser production build with no override, call back to the serving
  // origin (the legacy single-process mode). `window` is absent under Vite dev
  // and in the test runner, so guard it before use and fall back to localhost.
  const canUseWindowOrigin = !import.meta.env.DEV && typeof window !== 'undefined';
  const fallback = canUseWindowOrigin ? window.location.origin : 'http://localhost:8080';
  const url = new URL(configured || fallback);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_SERVER_URL must use http:// or https://');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SERVER_URL must be an origin without a path, query, or fragment');
  }
  return url.origin;
}

export const SERVER_URL = resolveServerUrl();
export const API_BASE_URL = `${SERVER_URL}/api/v1`;
export const MCP_URL = `${SERVER_URL}/mcp`;
