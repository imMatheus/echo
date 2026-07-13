import { useState } from 'react';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Monospace block with a copy button. */
export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className="codeblock">
      <pre>{code}</pre>
      <button type="button" className="btn btn-sm codeblock-copy" onClick={() => void onCopy()}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

/** Tiny inline copy icon button (for ids etc.). */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button type="button" className="copy-inline" onClick={() => void onCopy()} title={label} aria-label={label}>
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--success)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 7.5 5.5 11 12 3.5" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
          <path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
        </svg>
      )}
    </button>
  );
}
