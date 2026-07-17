import { useState } from 'react';
import type { ReactNode } from 'react';
import { LayersIcon } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';
import { ApiRequestError, errorMessage } from '@/api';
import { useAuth } from '@/auth';
import { useMemory, useRevalidateMemories, useScopes } from '@/hooks';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from '@/components/Badge';
import { CopyButton } from '@/components/CodeBlock';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { RelativeTime } from '@/components/RelativeTime';
import { RequestErrorState } from '@/components/RequestErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { canModifyMemory } from '@/lib/permissions';
import { cn } from '@/lib/utils';

function MetaItem({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 border-b border-border/60 py-2.5', full && 'md:col-span-2')}>
      <dt className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5 text-xs/relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Recessed panel matching the memory-card content well and the rest of the app. */
function Well({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-lg bg-grayscale-2 dark:bg-grayscale-2', className)} {...props} />;
}

/** Shared header: optional back link, then the memory's badge strip with actions. */
function Header({
  backLink,
  actions,
  trailing,
  children,
}: {
  backLink?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {backLink}
      <div className="flex items-start justify-between gap-3">
        <h2 className="sr-only">Memory</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          {trailing}
        </div>
      </div>
    </div>
  );
}

/**
 * Full detail of a single memory — content, metadata, and edit/delete controls.
 * Rendered both as a standalone page (`/memories/:id`) and inside a modal when a
 * memory is opened from a list. The layout is container-agnostic (a recessed
 * content well plus light section dividers, rather than nested cards) so it sits
 * cleanly on the page background or inside the dialog surface.
 */
export function MemoryDetailView({
  id,
  onLeave,
  backLink,
  trailing,
}: {
  id: string | undefined;
  /** Called after the memory is deleted or when "back" is used on a missing memory. */
  onLeave: () => void;
  /** Rendered above the header (e.g. a "← Memories" link on the standalone page). */
  backLink?: ReactNode;
  /** Rendered at the far right of the header row (e.g. a modal close button). */
  trailing?: ReactNode;
}) {
  const { user } = useAuth();

  const { data: memory, error, isLoading, mutate } = useMemory(id);
  const { data: scopes } = useScopes();
  const revalidateMemories = useRevalidateMemories();
  const notFound = error instanceof ApiRequestError && error.status === 404;
  const accessLost = Boolean(memory && scopes && !scopes.some((scope) => scope.id === memory.scopeId));

  // content editing
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    // The back link and close button are static — keep them in place and
    // skeleton only the content well and the details grid.
    return (
      <div className="flex flex-col gap-4">
        <Header backLink={backLink} trailing={trailing}>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </Header>
        <Well className="space-y-2.5 p-4" aria-hidden>
          {/* text-sm/relaxed lines (22.75px), matching the memory content. */}
          {['w-full', 'w-11/12', 'w-2/3'].map((w) => (
            <div key={w} className="flex h-[22.75px] items-center">
              <Skeleton className={cn('h-3.5', w)} />
            </div>
          ))}
        </Well>
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2" aria-hidden>
          {/* Mirrors MetaItem: py-2.5, 16px label line, gap-1, 20px value line. */}
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className={cn('flex flex-col gap-1 border-b border-border/60 py-2.5', i >= 10 && 'md:col-span-2')}
            >
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-16" />
              </div>
              <div className="flex h-5 items-center">
                <Skeleton className="h-4 w-28 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!memory && error && !notFound) {
    return <RequestErrorState error={error} onRetry={() => mutate()} />;
  }

  if (notFound || accessLost || !memory) {
    return (
      <EmptyState
        icon={<LayersIcon />}
        title="Memory not found"
        description="This memory may have been deleted or expired."
        action={
          <Button variant="outline" onClick={onLeave}>
            Back to memories
          </Button>
        }
      />
    );
  }

  const startEdit = () => {
    setDraft(memory.content);
    setEditing(true);
  };

  const saveContent = async () => {
    const content = draft.trim();
    if (!content) {
      toast.error('Content cannot be empty');
      return;
    }
    if (content.length > 10_000) {
      toast.error('Content must be 10,000 characters or fewer');
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateMemory(memory.id, { content });
      await mutate(res.memory, { revalidate: false });
      revalidateMemories();
      setEditing(false);
      toast.success('Memory updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const startEditTags = () => {
    setTagsDraft(memory.tags.join(', '));
    setEditingTags(true);
  };

  const saveTags = async () => {
    const tags = tagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 20) {
      toast.error('Use at most 20 tags');
      return;
    }
    if (tags.some((tag) => tag.length > 64)) {
      toast.error('Each tag must be 64 characters or fewer');
      return;
    }
    setSavingTags(true);
    try {
      const res = await api.updateMemory(memory.id, { tags });
      await mutate(res.memory, { revalidate: false });
      revalidateMemories();
      setEditingTags(false);
      toast.success('Tags updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingTags(false);
    }
  };

  const deleteMemory = async () => {
    try {
      await api.deleteMemory(memory.id);
      toast.success('Memory deleted');
      revalidateMemories();
      onLeave();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const hasMetadata = Object.keys(memory.metadata).length > 0;
  const canModify = canModifyMemory(memory, user?.id, scopes);

  return (
    <div className="flex flex-col gap-4">
      <Header
        backLink={backLink}
        trailing={trailing}
        actions={
          canModify && !editing ? (
            <Button variant="outline" size="sm" onClick={startEdit}>
              Edit
            </Button>
          ) : undefined
        }
      >
        <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
        <KindBadge kind={memory.kind} />
        <SensitivityBadge sensitivity={memory.sensitivity} />
        <span className="text-xs text-muted-foreground">
          <RelativeTime date={memory.createdAt} />
        </span>
      </Header>

      {editing && canModify ? (
        <div>
          <Textarea
            className="min-h-40"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Memory content"
            autoFocus
            maxLength={10_000}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveContent()} disabled={saving}>
              {saving && <Spinner />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Well className="p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{memory.content}</p>
        </Well>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">Details</h3>
        <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <MetaItem label="Scope">
            <ScopeBadge type={memory.scopeType} name={memory.scopeName} />
          </MetaItem>
          <MetaItem label="Kind">
            <KindBadge kind={memory.kind} />
          </MetaItem>
          <MetaItem label="Confidence">{memory.confidence}</MetaItem>
          <MetaItem label="Sensitivity">
            {memory.sensitivity === 'normal' ? 'normal' : <SensitivityBadge sensitivity={memory.sensitivity} />}
          </MetaItem>
          <MetaItem label="Source app">
            <SourceChip app={memory.sourceApp} />
          </MetaItem>
          <MetaItem label="Created by">
            {memory.createdByName ?? <span className="text-muted-foreground">—</span>}
          </MetaItem>
          <MetaItem label="Created">
            <RelativeTime date={memory.createdAt} />
          </MetaItem>
          <MetaItem label="Updated">
            <RelativeTime date={memory.updatedAt} />
          </MetaItem>
          <MetaItem label="Expires">
            {memory.expiresAt ? (
              <RelativeTime date={memory.expiresAt} />
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </MetaItem>
          <MetaItem label="Embedding model">
            {memory.embeddingModel ? (
              <span className="font-mono text-xs">{memory.embeddingModel}</span>
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </MetaItem>
          <MetaItem label="Memory ID" full>
            <span className="font-mono text-xs">{memory.id}</span>
            <CopyButton text={memory.id} label="Copy memory ID" />
          </MetaItem>
          <MetaItem label="Tags" full>
            {editingTags && canModify ? (
              <div className="flex w-full items-center gap-2">
                <Input
                  className="flex-1"
                  value={tagsDraft}
                  onChange={(e) => setTagsDraft(e.target.value)}
                  placeholder="comma, separated, tags"
                  aria-label="Tags"
                  autoFocus
                  maxLength={1_300}
                />
                <Button variant="outline" size="sm" onClick={() => setEditingTags(false)} disabled={savingTags}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void saveTags()} disabled={savingTags}>
                  {savingTags && <Spinner />}
                  Save
                </Button>
              </div>
            ) : (
              <>
                {memory.tags.length === 0 && <span className="text-muted-foreground">No tags</span>}
                {memory.tags.map((t) => (
                  <Tag key={t} tag={t} />
                ))}
                {canModify && (
                  <Button variant="ghost" size="sm" onClick={startEditTags}>
                    Edit
                  </Button>
                )}
              </>
            )}
          </MetaItem>
          {hasMetadata && (
            <MetaItem label="Metadata" full>
              <pre className="w-full whitespace-pre-wrap font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {JSON.stringify(memory.metadata, null, 2)}
              </pre>
            </MetaItem>
          )}
        </dl>
      </section>

      {canModify && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="text-xs text-muted-foreground">
            Deleting a memory removes it from every AI app connected to Echo.
          </span>
          <span className="flex-1" />
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete memory
          </Button>
        </div>
      )}

      {canModify && confirmDelete && (
        <ConfirmDialog
          title="Delete memory?"
          message={
            <>
              This permanently deletes the memory
              {memory.content.length > 80 ? (
                <>
                  {' '}
                  starting with <em>“{memory.content.slice(0, 80)}…”</em>
                </>
              ) : (
                <>
                  {' '}
                  <em>“{memory.content}”</em>
                </>
              )}
              . Connected AI apps will no longer be able to recall it.
            </>
          }
          confirmLabel="Delete memory"
          onConfirm={deleteMemory}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
