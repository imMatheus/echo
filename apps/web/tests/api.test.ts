import { describe, expect, test } from 'bun:test';
import { ApiRequestError, getMeta } from '../src/api';

describe('API request wrapper', () => {
  test('aborts a stalled request and returns a bounded timeout error', async () => {
    const originalFetch = globalThis.fetch;
    let timeoutCleared = false;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout(callback: () => void) {
          queueMicrotask(callback);
          return 1;
        },
        clearTimeout() {
          timeoutCleared = true;
        },
        dispatchEvent() {},
      },
    });
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      })) as typeof fetch;

    try {
      await expect(getMeta()).rejects.toEqual(
        expect.objectContaining<ApiRequestError>({
          status: 0,
          message: 'Request timed out after 30 seconds',
        }),
      );
      expect(timeoutCleared).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
