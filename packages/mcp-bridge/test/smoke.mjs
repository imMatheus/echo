import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const echoUrl = process.env.ECHO_URL;
const apiKey = process.env.ECHO_API_KEY;
if (!echoUrl || !apiKey) throw new Error('ECHO_URL and ECHO_API_KEY are required');

const bridgePath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bridgePath],
  env: { ...process.env, ECHO_URL: echoUrl, ECHO_API_KEY: apiKey },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', (chunk) => {
  stderr += String(chunk);
});

const client = new Client({ name: 'echo-bridge-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  const expected = ['forget_context', 'list_context', 'list_scopes', 'recall_context', 'remember_context'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`unexpected bridge tools: ${JSON.stringify(names)}`);
  }

  const scopesResult = await client.callTool({ name: 'list_scopes', arguments: {} });
  if (scopesResult.isError || scopesResult.content[0]?.type !== 'text') {
    throw new Error(`bridge list_scopes failed: ${JSON.stringify(scopesResult)}`);
  }
  const scopesPayload = JSON.parse(scopesResult.content[0].text);
  const scopeId = scopesPayload.scopes?.[0]?.id;
  if (typeof scopeId !== 'string') throw new Error('bridge returned no accessible scope');

  const result = await client.callTool({
    name: 'list_context',
    arguments: { limit: 1, scope: scopeId.toUpperCase() },
  });
  if (result.isError || result.content[0]?.type !== 'text') {
    throw new Error(`bridge tool call failed: ${JSON.stringify(result)}`);
  }
  const payload = JSON.parse(result.content[0].text);
  if (!Number.isInteger(payload.total) || !Array.isArray(payload.memories)) {
    throw new Error(`invalid bridge payload: ${result.content[0].text}`);
  }
  console.log('stdio bridge tools and list_context ok');
} catch (error) {
  if (stderr.trim()) console.error(stderr.trim());
  throw error;
} finally {
  await client.close();
}
