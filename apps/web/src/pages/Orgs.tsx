import { useState } from 'react'
import type { FormEvent } from 'react'
import { Building2Icon, PlusIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import * as api from '@/api'
import { errorMessage } from '@/api'
import { keys, useOrgs } from '@/hooks'
import { RoleBadge } from '@/components/Badge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { PreviewCard } from '@/components/PreviewCard'
import { RequestErrorState } from '@/components/RequestErrorState'
import { PreviewCardSkeleton } from '@/components/Skeletons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

export default function OrgsPage() {
  const { data: orgs, error, mutate } = useOrgs()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div>
      <PageHeader
        title="Organizations"
        subtitle="Share memories with your team through org, workspace, team, and project scopes."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon data-icon="inline-start" />
            New organization
          </Button>
        }
      />

      {!orgs && error ? (
        <RequestErrorState error={error} onRetry={() => mutate()} />
      ) : !orgs ? (
        <div
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(245px,1fr))]"
          aria-hidden
        >
          {Array.from({ length: 3 }, (_, i) => (
            <PreviewCardSkeleton key={i} />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<Building2Icon />}
          title="No organizations"
          description="Create an organization to share context with teammates across your AI tools."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon data-icon="inline-start" />
              New organization
            </Button>
          }
        />
      ) : (
        // Concentric tray of org cards, matching the home dashboard trays.
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(245px,1fr))]">
          {orgs.map((org) => (
            <PreviewCard
              key={org.id}
              to={`/orgs/${org.id}`}
              badge={<RoleBadge role={org.role} />}
              preview={
                <span className="font-heading text-3xl font-semibold text-grayscale-11">
                  {org.name.trim().charAt(0).toUpperCase() || '#'}
                </span>
              }
              title={org.name}
              description={`${org.memberCount} member${org.memberCount === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      )}

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setPending(true)
    try {
      const res = await api.createOrg({ name: name.trim() })
      void mutate(keys.orgs)
      toast.success(`Created ${res.org.name}`)
      navigate(`/orgs/${res.org.id}`)
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      disablePointerDismissal={pending}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                autoFocus
                required
                maxLength={100}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
