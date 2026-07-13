import type { Config } from '../config.js';

export interface EmbeddingProvider {
  /** Stored on each memory as provenance, e.g. "openai:text-embedding-3-small". */
  modelId: string;
  provider: string;
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  voyage: 'voyage-3-lite',
  ollama: 'nomic-embed-text',
};

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`embedding request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function createEmbeddingProvider(cfg: Config): EmbeddingProvider | null {
  const provider = cfg.EMBEDDINGS_PROVIDER;
  if (provider === 'none') return null;
  const model = cfg.EMBEDDINGS_MODEL ?? DEFAULT_MODELS[provider];
  const modelId = `${provider}:${model}`;

  if (provider === 'openai') {
    return {
      modelId,
      provider,
      model,
      async embed(texts) {
        const data = await postJson(
          `${cfg.OPENAI_BASE_URL}/embeddings`,
          { model, input: texts },
          { authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
        );
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      },
    };
  }

  if (provider === 'voyage') {
    return {
      modelId,
      provider,
      model,
      async embed(texts) {
        const data = await postJson(
          'https://api.voyageai.com/v1/embeddings',
          { model, input: texts },
          { authorization: `Bearer ${cfg.VOYAGE_API_KEY}` },
        );
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      },
    };
  }

  // ollama
  return {
    modelId,
    provider,
    model,
    async embed(texts) {
      const data = await postJson(`${cfg.OLLAMA_URL}/api/embed`, { model, input: texts }, {});
      return data.embeddings;
    },
  };
}

/** pgvector accepts the '[1,2,3]' text form with a ::vector cast. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
