import { FormEvent, useEffect, useState } from 'react'
import { TitleBar, TitleBarTitle } from './components/title-bar'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { DocEditor } from '@/components/doc-editor'
import { DocInvitesDialog } from '@/components/doc-invites-dialog'
import { DocJoinDialog } from '@/components/doc-join-dialog'
import { DocConflictView } from '@/components/doc-conflict-view'
import { EditorEmptyState } from '@/components/editor-empty-state'
import { EditorLoadingState } from '@/components/editor-loading-state'
import { useDocStore } from './state/doc-store'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar
} from './components/ui/sidebar'
import { FilePlus2, Lock, LogOut, MoreHorizontal, Pencil } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

function useDocState<T>(
  selector: (state: ReturnType<typeof useDocStore.getState>) => T
): T {
  return useDocStore(selector)
}

export function App() {
  const initialize = useDocState((state) => state.initialize)
  const activeDoc = useDocState((state) => state.activeDoc)
  const currentUpdate = useDocState((state) => state.currentUpdate)
  const loading = useDocState((state) => state.loading)
  const applySnapshot = useDocState((state) => state.applySnapshot)
  const conflict = useDocState((state) =>
    state.activeDoc ? (state.conflicts[state.activeDoc] ?? null) : null
  )
  const resyncDoc = useDocState((state) => state.resyncDoc)
  const forkDocFromConflict = useDocState((state) => state.forkDocFromConflict)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <>
      <SidebarProvider className='relative [--window-ctrl-width:78px] [--header-height:--spacing(12)] [--sidebar-width:--spacing(72)]'>
        <div className='absolute h-(--header-height) w-(--window-ctrl-width) px-3 debug top-0 left-0 pt-[calc(--spacing(5)-1px)]'>
          {/* @ts-ignore */}
          <pear-ctrl></pear-ctrl>
        </div>

        <DocsSidebar />

        <SidebarInset className='h-dvh grid grid-cols-1 grid-rows-[auto_1fr]'>
          <DocsTitleBar />
          {conflict && activeDoc ? (
            <DocConflictView
              key={activeDoc}
              docKey={activeDoc}
              conflict={conflict}
              onResync={() => resyncDoc(activeDoc!)}
              onFork={() => forkDocFromConflict(activeDoc!)}
            />
          ) : currentUpdate ? (
            <div>
              {currentUpdate.lockedAt ? (
                <DocLockedNotice lockedAt={currentUpdate.lockedAt} />
              ) : null}
              <DocEditor
                docKey={currentUpdate.key}
                snapshot={currentUpdate.snapshot}
                readOnly={
                  currentUpdate.lockedAt != null ||
                  currentUpdate.capabilities?.canEdit === false
                }
                onSnapshotChange={(nextSnapshot) =>
                  applySnapshot(currentUpdate.key, nextSnapshot)
                }
              />
            </div>
          ) : loading ? (
            <EditorLoadingState />
          ) : activeDoc ? (
            <StatusMessage>Waiting for snapshot…</StatusMessage>
          ) : (
            <EditorEmptyState />
          )}
        </SidebarInset>
      </SidebarProvider>
      <Toaster position='bottom-right' richColors closeButton />
    </>
  )
}

function DocsTitleBar() {
  const activeDoc = useDocState((state) => state.activeDoc)
  const docs = useDocState((state) => state.docs)
  const capabilities = useDocState((state) => state.currentUpdate?.capabilities)
  const lockDocAction = useDocState((state) => state.lockDoc)
  const abandonDocAction = useDocState((state) => state.abandonDoc)
  const lockingDoc = useDocState((state) => state.lockingDoc)
  const abandoningDoc = useDocState((state) => state.abandoningDoc)
  const renameDoc = useDocState((state) => state.renameDoc)
  const fullDoc = docs.find((doc) => doc.key === activeDoc)
  const { open } = useSidebar()
  const lockedAt = fullDoc?.lockedAt ?? null
  const isLocked = Boolean(lockedAt)
  const isReadOnly =
    Boolean(activeDoc) &&
    !!fullDoc &&
    (isLocked || capabilities?.canEdit === false)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [lockOpen, setLockOpen] = useState(false)
  const [abandonOpen, setAbandonOpen] = useState(false)

  useEffect(() => {
    if (renameOpen) {
      setRenameValue(fullDoc?.title ?? '')
      setRenameError(null)
    }
  }, [renameOpen, fullDoc?.title])

  useEffect(() => {
    if (!renameOpen) {
      setRenaming(false)
      setRenameError(null)
    }
  }, [renameOpen])

  const handleRenameSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    if (event) {
      event.preventDefault()
    }
    if (!activeDoc) return

    const trimmed = renameValue.trim()
    const currentTitle = (fullDoc?.title ?? '').trim()
    if (trimmed === currentTitle) {
      setRenameOpen(false)
      return
    }

    setRenaming(true)
    setRenameError(null)

    try {
      await renameDoc(activeDoc, renameValue)
      setRenameOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to rename document'
      setRenameError(message)
    } finally {
      setRenaming(false)
    }
  }

  const handleLockConfirm = async () => {
    if (!activeDoc) return
    try {
      await lockDocAction(activeDoc)
      toast('Document locked', {
        description: 'Edits and invites are disabled until it is unlocked.'
      })
      setLockOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to lock document'
      toast.error('Lock failed', { description: message })
    }
  }

  const handleAbandonConfirm = async () => {
    if (!activeDoc) return
    try {
      await abandonDocAction(activeDoc)
      toast('Document removed', {
        description: 'It has been forgotten locally, but may live on elsewhere.'
      })
      setAbandonOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to abandon document'
      toast.error('Abandon failed', { description: message })
    }
  }

  const lockedAtLabel = lockedAt ? new Date(lockedAt).toLocaleString() : null

  return (
    <>
      <TitleBar
        data-sidebar-open={open}
        className='border-b w-full flex gap-2 items-center h-(--header-height) data-[sidebar-open=true]:pl-3 pl-(--window-ctrl-width)'
      >
        <SidebarTrigger className='' />
        <TitleBarTitle className='flex flex-1 items-center gap-2'>
          {fullDoc?.title ? (
            <span>{fullDoc.title}</span>
          ) : (
            <span className='text-muted-foreground'>Bonk Docs</span>
          )}
          {isLocked ? (
            <Badge
              className='px-2 py-0.5 text-[0.65rem] uppercase tracking-wide'
              variant='destructive'
            >
              Locked
            </Badge>
          ) : isReadOnly ? (
            <Badge className='px-2 py-0.5 text-[0.65rem] uppercase tracking-wide'>
              Read-only
            </Badge>
          ) : null}
        </TitleBarTitle>
        {fullDoc ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size='icon-sm'
                variant='ghost'
                className='text-muted-foreground'
                aria-label='Document actions'
              >
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' sideOffset={4} className='w-48'>
              <DropdownMenuItem
                disabled={isReadOnly}
                onSelect={(event) => {
                  event.preventDefault()
                  if (isReadOnly) return
                  setRenameOpen(true)
                }}
              >
                <Pencil className='mr-2 h-4 w-4' /> Rename document
              </DropdownMenuItem>
              {isLocked ? (
                <DropdownMenuItem disabled>
                  <Lock className='mr-2 h-4 w-4' /> Locked
                  {lockedAtLabel ? ` - ${lockedAtLabel}` : ''}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={lockingDoc}
                  onSelect={(event) => {
                    event.preventDefault()
                    if (lockingDoc) return
                    setLockOpen(true)
                  }}
                >
                  <Lock className='mr-2 h-4 w-4' /> Lock doc
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={abandoningDoc}
                onSelect={(event) => {
                  event.preventDefault()
                  if (abandoningDoc) return
                  setAbandonOpen(true)
                }}
              >
                <LogOut className='mr-2 h-4 w-4' /> Abandon doc
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <DocInvitesDialog />
      </TitleBar>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>
              Choose a new name to help identify this document.
            </DialogDescription>
          </DialogHeader>
          <form className='space-y-4' onSubmit={handleRenameSubmit}>
            <Input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder='Untitled document'
            />
            {renameError ? (
              <p className='text-sm text-destructive'>{renameError}</p>
            ) : null}
            <DialogFooter className='flex gap-2 justify-end'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type='submit' size='sm' disabled={renaming}>
                {renaming ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={lockOpen} onOpenChange={setLockOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Lock document</DialogTitle>
            <DialogDescription>
              Locking ends editing for everyone. There is no undo yet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='flex gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setLockOpen(false)}
              disabled={lockingDoc}
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              variant='destructive'
              disabled={lockingDoc}
              onClick={handleLockConfirm}
            >
              {lockingDoc ? 'Locking…' : 'Lock doc'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Abandon document</DialogTitle>
            <DialogDescription>
              This only forgets the document locally. Other peers keep their
              copies.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='flex gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setAbandonOpen(false)}
              disabled={abandoningDoc}
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              variant='destructive'
              disabled={abandoningDoc}
              onClick={handleAbandonConfirm}
            >
              {abandoningDoc ? 'Abandoning…' : 'Abandon doc'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DocsSidebar({ ...props }) {
  const activeDoc = useDocState((state) => state.activeDoc)
  const docs = useDocState((state) => state.docs)
  const loading = useDocState((state) => state.loading)
  const selectDoc = useDocState((state) => state.selectDoc)
  const createDoc = useDocState((state) => state.createDoc)
  const creatingDoc = useDocState((state) => state.creatingDoc)

  const handleCreateDoc = async () => {
    if (creatingDoc) return

    try {
      await createDoc('Untitled')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create document'
      toast.error('Create doc failed', { description: message })
    }
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader className='flex-row border-b h-(--header-height) flex items-center justify-end'>
        <DocJoinDialog />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size='icon-sm'
              variant='outline'
              onClick={() => void handleCreateDoc()}
              disabled={creatingDoc}
              aria-busy={creatingDoc}
            >
              <FilePlus2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New doc</TooltipContent>
        </Tooltip>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Docs</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {docs.map((doc) => (
                <SidebarMenuItem key={doc.key}>
                  <SidebarMenuButton
                    isActive={activeDoc === doc.key}
                    onClick={() => {
                      void selectDoc(doc.key)
                    }}
                  >
                    <span className='flex w-full items-center gap-2'>
                      <span className='truncate'>
                        {doc.title || 'Untitled document'}
                      </span>
                      {doc.lockedAt ? (
                        <Lock
                          className='ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground'
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {loading && docs.length === 0 && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuSkeleton />
                  </SidebarMenuItem>
                </>
              )}
              {!loading && docs.length === 0 && (
                <SidebarMenuItem className='text-muted-foreground italic'>
                  <SidebarMenuButton disabled>No docs yet</SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

function DocLockedNotice({ lockedAt }: { lockedAt: number }) {
  const formatted = Number.isFinite(lockedAt)
    ? new Date(lockedAt).toLocaleString()
    : null

  return (
    <div className='flex items-center gap-2 border-b border-amber-200 bg-amber-100 px-4 py-2 text-sm text-amber-900'>
      <Lock className='h-4 w-4 shrink-0' aria-hidden />
      <span>
        Document locked
        {formatted ? ` on ${formatted}` : ''}. Changes are disabled.
      </span>
    </div>
  )
}

function StatusMessage({ ...props }) {
  return (
    <div
      className='p-5 text-muted-foreground flex items-center justify-center'
      {...props}
    />
  )
}
