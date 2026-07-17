import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@/config';
import { createEmbeddingProvider, toVectorLiteral } from '@/lib/embeddings';

function okFetch(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createEmbeddingProvider', () => {
  it('returns null when embeddings are disabled', () => {
    expect(createEmbeddingProvider(loadConfig({ EMBEDDINGS_PROVIDER: 'none' }))).toBeNull();
  });

  it('builds an OpenAI provider with the default model and calls the embeddings endpoint', async () => {
    const fetchMock = okFetch({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider(loadConfig({ EMBEDDINGS_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }));
    expect(provider?.provider).toBe('openai');
    expect(provider?.model).toBe('text-embedding-3-small');
    expect(provider?.modelId).toBe('openai:text-embedding-3-small');

    const vectors = await provider!.embed(['a', 'b']);
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'] });
  });

  it('honors an EMBEDDINGS_MODEL override', () => {
    const provider = createEmbeddingProvider(
      loadConfig({
        EMBEDDINGS_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        EMBEDDINGS_MODEL: 'text-embedding-3-large',
      }),
    );
    expect(provider?.model).toBe('text-embedding-3-large');
    expect(provider?.modelId).toBe('openai:text-embedding-3-large');
  });

  it('builds a Voyage provider that posts to the Voyage API', async () => {
    const fetchMock = okFetch({ data: [{ embedding: [1, 2, 3] }] });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider(loadConfig({ EMBEDDINGS_PROVIDER: 'voyage', VOYAGE_API_KEY: 'vo-test' }));
    expect(provider?.model).toBe('voyage-3-lite');
    expect(await provider!.embed(['x'])).toEqual([[1, 2, 3]]);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://api.voyageai.com/v1/embeddings',
    );
  });

  it('builds an Ollama provider that reads the embeddings array shape', async () => {
    const fetchMock = okFetch({ embeddings: [[9, 8, 7]] });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider(loadConfig({ EMBEDDINGS_PROVIDER: 'ollama' }));
    expect(provider?.model).toBe('nomic-embed-text');
    expect(await provider!.embed(['x'])).toEqual([[9, 8, 7]]);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'http://localhost:11434/api/embed',
    );
  });

  it('throws with the upstream status when the embedding request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, text: async () => 'unavailable' })) as unknown as typeof fetch,
    );
    const provider = createEmbeddingProvider(loadConfig({ EMBEDDINGS_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }));
    await expect(provider!.embed(['x'])).rejects.toThrow('embedding request failed (503)');
  });
});

describe('toVectorLiteral edge cases', () => {
  it('rejects vectors that exceed the pgvector size guard', () => {
    expect(() => toVectorLiteral(new Array(16_001).fill(1))).toThrow('invalid vector');
  });
});
