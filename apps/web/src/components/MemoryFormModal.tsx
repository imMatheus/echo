import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateMemoryRequest, Memory, MemoryKind, ScopeWithAccess, Sensitivity } from '@echo/shared';
import { MEMORY_KINDS, SENSITIVITIES } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { ScopeSelectItems, scopeSelectItems } from './ScopeOptions';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

const KIND_LABELS: Record<MemoryKind, string> = {
  explicit: 'User-provided',
  inferred: 'AI-inferred',
};

const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: 'Low sensitivity',
  normal: 'Normal sensitivity',
  high: 'High sensitivity',
};

const KIND_ITEMS = MEMORY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }));
const SENSITIVITY_ITEMS = SENSITIVITIES.map((sensitivity) => ({
  value: sensitivity,
  label: SENSITIVITY_LABELS[sensitivity],
}));

export function MemoryFormModal({
  scopes,
  defaultScopeId,
  onClose,
  onCreated,
}: {
  /** All scopes the modal may offer; only canWrite scopes are shown. */
  scopes: ScopeWithAccess[];
  defaultScopeId?: string;
  onClose: () => void;
  onCreated: (memory: Memory) => void;
}) {
  const writable = scopes.filter((s) => s.canWrite);

  const [content, setContent] = useState('');
  const [scopeId, setScopeId] = useState<string>(() => {
    if (defaultScopeId && writable.some((s) => s.id === defaultScopeId)) return defaultScopeId;
    return writable[0]?.id ?? '';
  });
  const [kind, setKind] = useState<MemoryKind>('explicit');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal');
  const [confidence, setConfidence] = useState('1');
  const [tags, setTags] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (writable.some((scope) => scope.id === scopeId)) return;
    const fallback =
      defaultScopeId && writable.some((scope) => scope.id === defaultScopeId)
        ? defaultScopeId
        : (writable[0]?.id ?? '');
    setScopeId(fallback);
  }, [defaultScopeId, scopeId, writable]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = content.trim();
    if (!trimmed) {
      setError('Content is required');
      return;
    }
    const conf = Number(confidence);
    if (!confidence.trim() || Number.isNaN(conf) || conf < 0 || conf > 1) {
      setError('Confidence must be a number between 0 and 1');
      return;
    }
    if (!scopeId) {
      setError('Pick a scope to store this memory in');
      return;
    }

    const body: CreateMemoryRequest = {
      content: trimmed,
      scopeId,
      kind,
      sensitivity,
      confidence: conf,
    };
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagList.length > 20) {
      setError('Use at most 20 tags');
      return;
    }
    if (tagList.some((tag) => tag.length > 64)) {
      setError('Each tag must be 64 characters or fewer');
      return;
    }
    if (tagList.length > 0) body.tags = tagList;
    if (expiresAt) {
      const date = new Date(expiresAt);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        setError('Expiry must be a future date and time');
        return;
      }
      body.expiresAt = date.toISOString();
    }

    setPending(true);
    try {
      const res = await api.createMemory(body);
      onCreated(res.memory);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal={pending} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>New memory</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="mem-content">Content</FieldLabel>
              <Textarea
                id="mem-content"
                className="min-h-28"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What should your AI tools remember?"
                autoFocus
                required
                maxLength={10_000}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="mem-scope">Scope</FieldLabel>
              <Select items={scopeSelectItems(writable)} value={scopeId} onValueChange={(v) => setScopeId(v as string)}>
                <SelectTrigger id="mem-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <ScopeSelectItems scopes={writable} />
                </SelectContent>
              </Select>
              <FieldDescription>Scope controls which people can access this memory through Echo.</FieldDescription>
            </Field>

            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="mem-kind">How it was learned</FieldLabel>
                <Select items={KIND_ITEMS} value={kind} onValueChange={(v) => setKind(v as MemoryKind)}>
                  <SelectTrigger id="mem-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Use AI-inferred only when a model derived this rather than the user stating it.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mem-sensitivity">Sensitivity</FieldLabel>
                <Select
                  items={SENSITIVITY_ITEMS}
                  value={sensitivity}
                  onValueChange={(v) => setSensitivity(v as Sensitivity)}
                >
                  <SelectTrigger id="mem-sensitivity" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SENSITIVITY_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Classification only—it does not restrict access. Scope controls access.
                </FieldDescription>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="mem-confidence">Confidence (0–1)</FieldLabel>
                <Input
                  id="mem-confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={confidence}
                  onChange={(e) => setConfidence(e.target.value)}
                  required
                />
                <FieldDescription>1 means certain; use a lower value when the memory may be wrong.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mem-expires">Expires (optional)</FieldLabel>
                <Input
                  id="mem-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                <FieldDescription>The memory stops appearing after this time.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="mem-tags">Tags</FieldLabel>
              <Input
                id="mem-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
                maxLength={1_300}
              />
              <FieldDescription>Comma-separated labels used to organize and filter memories.</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create memory
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
