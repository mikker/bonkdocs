import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useDocStore } from '@/state/doc-store'
import { toast } from 'sonner'
import { Copy, FileUser, RefreshCw, Trash2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

const READ_ROLE = 'doc-viewer'
const WRITE_ROLE = 'doc-editor'

function getRoleLabel(role: string) {
  switch (role) {
    case READ_ROLE:
      return 'Read'
    case WRITE_ROLE:
      return 'Write'
    case 'doc-commenter':
      return 'Comment'
    case 'doc-owner':
      return 'Owner'
    default:
      return role
  }
}

async function copyToClipboard(code: string) {
  if (!code) {
    throw new Error('Invite has no shareable code')
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard unavailable')
  }
  await navigator.clipboard.writeText(code)
}

export function DocInvitesDialog() {
  const [open, setOpen] = useState(false)
  const [allowWrite, setAllowWrite] = useState(false)
  const [creating, setCreating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const activeDoc = useDocStore((state) => state.activeDoc)
  const invitesMap = useDocStore((state) => state.invites)
  const invitesLoading = useDocStore((state) => state.invitesLoading)
  const invitesError = useDocStore((state) => state.invitesError)
  const loadInvites = useDocStore((state) => state.loadInvites)
  const refreshInvites = useDocStore((state) => state.refreshInvites)
  const createDocInvite = useDocStore((state) => state.createDocInvite)
  const revokeDocInvite = useDocStore((state) => state.revokeDocInvite)
  const capabilities = useDocStore((state) => state.currentUpdate?.capabilities)
  const lockedAt = useDocStore((state) => state.currentUpdate?.lockedAt)

  const invites = useMemo(() => {
    if (!activeDoc) return undefined
    return invitesMap[activeDoc]
  }, [invitesMap, activeDoc])

  const isLocked = typeof lockedAt === 'number' && Number.isFinite(lockedAt)
  const canManageInvites = capabilities?.canInvite === true && !isLocked
  const invitesReady = Array.isArray(invites)
  const inviteCount = invitesReady ? invites.length : 0
  const badgeValue = isLocked
    ? 'L'
    : canManageInvites
      ? invitesReady
        ? inviteCount.toString()
        : '…'
      : '–'

  useEffect(() => {
    if (!open) {
      setAllowWrite(false)
      return
    }
    if (!activeDoc) return
    if (invitesError) return
    if (!canManageInvites) return

    if (invites === undefined && !invitesLoading) {
      void loadInvites(activeDoc).catch(() => {})
    }
  }, [
    open,
    activeDoc,
    invites,
    invitesLoading,
    invitesError,
    loadInvites,
    canManageInvites
  ])

  const handleRefresh = async () => {
    if (!activeDoc) return
    setRefreshing(true)
    try {
      await refreshInvites()
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'Failed to refresh invites'
      toast.error('Refresh failed', { description })
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeDoc) {
      toast.error('Select a document first', {
        description: 'Choose a document and try again.'
      })
      return
    }
    if (isLocked) {
      toast.error('Document locked', {
        description: 'Unlock before creating new invites.'
      })
      return
    }
    if (!canManageInvites) {
      toast.error('Invite creation blocked', {
        description: 'You do not have permission to manage invites.'
      })
      return
    }

    setCreating(true)
    try {
      const result = await createDocInvite({
        roles: allowWrite ? [WRITE_ROLE] : []
      })
      if (result?.invite) {
        try {
          await copyToClipboard(result.invite)
          toast('Invite copied', {
            description: 'Share the code so collaborators can join.'
          })
        } catch (error) {
          const description =
            error instanceof Error ? error.message : 'Copy to clipboard failed'
          toast.success('Invite created', {
            description: `Copy manually if needed. (${description})`
          })
        }
      } else {
        toast.success('Invite created', {
          description: 'Share the new invite code with collaborators.'
        })
      }
      setAllowWrite(false)
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'Failed to create invite'
      toast.error('Invite creation failed', { description })
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async (code: string) => {
    if (!code) {
      toast.error('Invite unavailable', {
        description: 'This invite has no shareable code.'
      })
      return
    }
    try {
      await copyToClipboard(code)
      toast('Invite copied', {
        description: 'Share the code so collaborators can join.'
      })
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'Clipboard permission denied'
      toast.error('Copy failed', { description })
    }
  }

  const handleRevoke = async (inviteId: string) => {
    if (!canManageInvites) {
      toast.error('Invite removal blocked', {
        description: 'You do not have permission to manage invites.'
      })
      return
    }
    try {
      await revokeDocInvite({ inviteId })
      toast.success('Invite revoked', {
        description: 'The invite can no longer be used.'
      })
    } catch (error) {
      const description =
        error instanceof Error ? error.message : 'Failed to revoke invite'
      toast.error('Revoke failed', { description })
    }
  }

  const statusMessage = isLocked
    ? 'Invites are frozen because this document is locked.'
    : !canManageInvites
      ? 'You do not have permission to manage invites for this document.'
      : invitesLoading
        ? 'Loading invites…'
        : inviteCount === 0
          ? 'No invites yet. Create one to share this document.'
          : `${inviteCount} active ${inviteCount === 1 ? 'invite' : 'invites'}.`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <span className='inline-flex'>
              <Button
                size='sm'
                variant='outline'
                disabled={!activeDoc || !canManageInvites}
                className='gap-2'
              >
                <FileUser />
                <span>Share</span>
                <Badge className='min-w-[1.75rem] justify-center'>
                  {badgeValue}
                </Badge>
              </Button>
            </span>
          </DialogTrigger>
        </TooltipTrigger>
        {!canManageInvites ? (
          <TooltipContent>
            {isLocked
              ? 'Document is locked. Unlock before managing invites.'
              : 'Only document creators can manage invites.'}
          </TooltipContent>
        ) : null}
      </Tooltip>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Document invites</DialogTitle>
          <DialogDescription>
            {canManageInvites
              ? 'Create and revoke invite codes that grant access to this document.'
              : 'View existing invite codes for this document.'}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-sm text-muted-foreground'>{statusMessage}</p>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => {
                void handleRefresh()
              }}
              disabled={refreshing || !activeDoc || !canManageInvites}
            >
              <RefreshCw className='mr-2 h-4 w-4' />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
          {invitesError ? (
            <p className='text-sm text-destructive'>{invitesError}</p>
          ) : null}

          {canManageInvites ? (
            <form
              className='space-y-3 rounded-md border border-border/60 bg-background/90 p-3'
              onSubmit={handleCreate}
            >
              <div className='space-y-1'>
                <h4 className='text-sm font-medium'>Create invite</h4>
                <p className='text-xs text-muted-foreground'>
                  Select permissions to include.
                </p>
              </div>
              <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                  <Checkbox id='doc-invite-read' checked readOnly disabled />
                  <Label htmlFor='doc-invite-read'>Read access</Label>
                </div>
                <div className='flex items-center gap-2'>
                  <Checkbox
                    id='doc-invite-write'
                    checked={allowWrite}
                    onCheckedChange={(value) => setAllowWrite(value === true)}
                    disabled={creating || !canManageInvites}
                  />
                  <Label htmlFor='doc-invite-write'>Write access</Label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type='submit'
                  size='sm'
                  disabled={creating || !activeDoc || !canManageInvites}
                >
                  {creating ? 'Creating…' : 'Create invite'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          <div className='space-y-2'>
            {canManageInvites &&
            Array.isArray(invites) &&
            invites.length === 0 &&
            !invitesLoading ? (
              <div className='rounded-md border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground'>
                There are no active invites.
              </div>
            ) : null}
            {canManageInvites && Array.isArray(invites)
              ? invites.map((invite) => {
                  const labels =
                    invite.roles.length > 0 ? invite.roles : [READ_ROLE]
                  return (
                    <div
                      key={invite.id || invite.invite}
                      className='space-y-2 rounded-md border border-border/60 p-3'
                    >
                      <div className='flex flex-wrap items-center justify-between gap-2'>
                        <code className='text-sm font-mono text-foreground break-all'>
                          {invite.invite || 'No code available'}
                        </code>
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => {
                              void handleCopy(invite.invite)
                            }}
                            disabled={!invite.invite}
                          >
                            <Copy className='mr-2 h-4 w-4' />
                            Copy
                          </Button>
                          {canManageInvites ? (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => {
                                void handleRevoke(invite.id)
                              }}
                            >
                              <Trash2 className='mr-2 h-4 w-4' />
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                        <span>Permissions:</span>
                        {labels.map((role) => (
                          <Badge key={`${invite.id}-${role}`} variant='outline'>
                            {getRoleLabel(role)}
                          </Badge>
                        ))}
                      </div>
                      {invite.revokedAt ? (
                        <p className='text-xs text-destructive'>
                          Revoked invite
                        </p>
                      ) : null}
                    </div>
                  )
                })
              : null}
            {!canManageInvites ? (
              <div className='rounded-md border border-border/60 bg-muted/10 p-3 text-sm text-muted-foreground'>
                Invite management is unavailable with your current permissions.
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
