import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the compatibility path below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Monospace block with a copy button. */
export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error('Could not copy to the clipboard');
    }
  };

  return (
    <div className="relative rounded-lg border bg-background dark:bg-input/10">
      <pre className="overflow-x-auto whitespace-pre py-3 pl-3 pr-20 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <Button variant="outline" size="sm" className="absolute right-2 top-2" onClick={() => void onCopy()}>
        {copied ? 'Copied!' : 'Copy'}
      </Button>
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
    } else {
      toast.error('Could not copy to the clipboard');
    }
  };

  return (
    <Button variant="ghost" size="icon-sm" onClick={() => void onCopy()} title={label} aria-label={label}>
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}
