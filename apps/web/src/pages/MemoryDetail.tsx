import { useState } from 'react';
import type { ReactNode } from 'react';
import { LayersIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api';
import { ApiRequestError, errorMessage } from '@/api';
import { useMemory, useRevalidateMemories } from '@/hooks';
import { KindBadge, ScopeBadge, SensitivityBadge, SourceChip, Tag } from '@/components/Badge';
import { CopyButton } from '@/components/CodeBlock';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { PageLoading } from '@/components/PageLoading';
import { RelativeTime } from '@/components/RelativeTime';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function MetaItem({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 border-b py-2.5', full && 'md:col-span-2')}>
      <dt className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5 text-xs/relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: memory, error, isLoading, mutate } = useMemory(id);
  const revalidateMemories = useRevalidateMemories();
  const notFound = error instanceof ApiRequestError && error.status === 404;

  // content editing
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) return <PageLoading />;

  if (notFound || !memory) {
    return (
      <EmptyState
        icon={<LayersIcon />}
        title="Memory not found"
        description="This memory may have been deleted or expired."
        action={
          <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to memories
          </Link>
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
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const hasMetadata = Object.keys(memory.metadata).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Memory"
        backLink={
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Memories
          </Link>
        }
        actions={
          !editing && (
            <Button variant="outline" onClick={startEdit}>
              Edit
            </Button>
          )
        }
      />

      <Card className="-mt-2">
        <CardContent>
          {editing ? (
            <div>
              <Textarea
                className="min-h-40"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Memory content"
                autoFocus
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={() => void saveContent()} disabled={saving}>
                  {saving && <Spinner />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
              {memory.content}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
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
              {editingTags ? (
                <div className="flex w-full items-center gap-2">
                  <Input
                    className="flex-1"
                    value={tagsDraft}
                    onChange={(e) => setTagsDraft(e.target.value)}
                    placeholder="comma, separated, tags"
                    aria-label="Tags"
                    autoFocus
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
                  <Button variant="ghost" size="sm" onClick={startEditTags}>
                    Edit
                  </Button>
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
        </CardContent>
      </Card>

      <Card className="border-destructive/35">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Deleting a memory removes it from every AI app connected to Echo.
            </span>
            <span className="flex-1" />
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete memory
            </Button>
          </div>
        </CardContent>
      </Card>

      {confirmDelete && (
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
