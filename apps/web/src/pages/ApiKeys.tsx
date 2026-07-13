import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRoundIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { ApiKeyInfo } from '@echo/shared';
import * as api from '../api';
import { errorMessage } from '../api';
import { SourceChip } from '../components/Badge';
import { CodeBlock } from '../components/CodeBlock';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { PageLoading } from '../components/PageLoading';
import { RelativeTime } from '../components/RelativeTime';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const load = useCallback(() => {
    api
      .listApiKeys()
      .then((res) => setKeys(res.keys))
      .catch((err) => toast.error(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeApiKey(revokeTarget.id);
      toast.success(`Revoked “${revokeTarget.name}”`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle={
          <>
            Keys let AI apps read and write your memories over MCP. See{' '}
            <Link to="/connect" className="font-medium text-foreground underline underline-offset-4">
              Connect
            </Link>{' '}
            for setup instructions.
          </>
        }
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            Create key
          </Button>
        }
      />

      {keys === null ? (
        <PageLoading />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRoundIcon />}
          title="No API keys"
          description="Create a key to connect Claude, Cursor, or any MCP client to your Echo memories."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon data-icon="inline-start" />
              Create key
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source app</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const revoked = key.revokedAt !== null;
                return (
                  <TableRow key={key.id} className={cn(revoked && 'opacity-60')}>
                    <TableCell className="font-semibold">{key.name}</TableCell>
                    <TableCell>
                      <SourceChip app={key.sourceApp} />
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{key.keyPrefix}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <RelativeTime date={key.createdAt} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.lastUsedAt ? <RelativeTime date={key.lastUsedAt} /> : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={revoked ? 'secondary' : 'outline'}
                        className={cn(!revoked && 'border-success/35 bg-success/10 text-success')}
                      >
                        {revoked ? 'revoked' : 'active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!revoked && (
                        <Button variant="destructive" size="sm" onClick={() => setRevokeTarget(key)}>
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal
          onClose={() => setShowCreate(false)}
          onCreated={(name, secret) => {
            setShowCreate(false);
            setNewSecret({ name, secret });
            load();
          }}
        />
      )}

      {newSecret && (
        <Dialog open onOpenChange={(open) => !open && setNewSecret(null)}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Key created: {newSecret.name}</DialogTitle>
            </DialogHeader>
            <Alert className="border-warning/40 text-warning">
              <TriangleAlertIcon />
              <AlertDescription className="text-warning/90">
                This is the only time the full key is shown. Copy it now and store it somewhere safe — Echo
                keeps only a hashed version.
              </AlertDescription>
            </Alert>
            <CodeBlock code={newSecret.secret} />
            <DialogFooter>
              <Button onClick={() => setNewSecret(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke API key?"
          message={
            <>
              Apps using <strong>{revokeTarget.name}</strong> ({revokeTarget.keyPrefix}) will immediately lose
              access. This cannot be undone.
            </>
          }
          confirmLabel="Revoke key"
          onConfirm={revoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, secret: string) => void;
}) {
  const [name, setName] = useState('');
  const [sourceApp, setSourceApp] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setPending(true);
    try {
      const res = await api.createApiKey({
        name: name.trim(),
        sourceApp: sourceApp.trim() || undefined,
      });
      onCreated(res.key.name, res.secret);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Laptop — Claude Code"
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="key-source">Source app</FieldLabel>
              <Input
                id="key-source"
                value={sourceApp}
                onChange={(e) => setSourceApp(e.target.value)}
                placeholder="claude-code, cursor, chatgpt…"
              />
              <FieldDescription>Label attached to memories written with this key.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
