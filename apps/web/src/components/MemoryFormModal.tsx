import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateMemoryRequest,
  Memory,
  MemoryKind,
  ScopeWithAccess,
  Sensitivity,
} from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { ScopeSelectItems, scopeSelectItems } from './ScopeOptions';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

const KIND_ITEMS = [
  { value: 'explicit', label: 'explicit' },
  { value: 'inferred', label: 'inferred' },
];

const SENSITIVITY_ITEMS = [
  { value: 'low', label: 'low' },
  { value: 'normal', label: 'normal' },
  { value: 'high', label: 'high' },
];

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = content.trim();
    if (!trimmed) {
      setError('Content is required');
      return;
    }
    const conf = Number(confidence);
    if (Number.isNaN(conf) || conf < 0 || conf > 1) {
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
    if (tagList.length > 0) body.tags = tagList;
    if (expiresAt) {
      const date = new Date(expiresAt);
      if (Number.isNaN(date.getTime())) {
        setError('Invalid expiry date');
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
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
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="mem-scope">Scope</FieldLabel>
              <Select
                items={scopeSelectItems(writable)}
                value={scopeId}
                onValueChange={(v) => setScopeId(v as string)}
              >
                <SelectTrigger id="mem-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <ScopeSelectItems scopes={writable} />
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Field>
                <FieldLabel htmlFor="mem-kind">Kind</FieldLabel>
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
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="mem-expires">Expires (optional)</FieldLabel>
                <Input
                  id="mem-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="mem-tags">Tags</FieldLabel>
              <Input
                id="mem-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
              />
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
