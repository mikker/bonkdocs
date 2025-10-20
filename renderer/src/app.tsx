import { FormEvent, useEffect, useState } from 'react'
import { TitleBar, TitleBarTitle } from './components/title-bar'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { DocEditor } from '@/components/doc-editor'
import { DocInvitesDialog } from '@/components/doc-invites-dialog'
import { DocJoinDialog } from '@/components/doc-join-dialog'
import { DocConflictView } from '@/components/doc-conflict-view'
import { EditorEmptyState } from '@/components/editor-empty-state'
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
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar
} from './components/ui/sidebar'
import { FilePlus2, MoreHorizontal, Pencil } from 'lucide-react'
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

function useDocState<T>(
  selector: (state: ReturnType<typeof useDocStore.getState>) => T
): T {
  return useDocStore(selector)
}

export function App() {
  const initialize = useDocState((state) => state.initialize)
  const activeDoc = useDocState((state) => state.activeDoc)
  const currentUpdate = useDocState((state) => state.currentUpdate)
  const applySnapshot = useDocState((state) => state.applySnapshot)
  const conflict = useDocState((state) =>
    state.activeDoc ? state.conflicts[state.activeDoc] ?? null : null
  )
  const resyncDoc = useDocState((state) => state.resyncDoc)
  const forkDocFromConflict = useDocState(
    (state) => state.forkDocFromConflict
  )

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
            <>
              <DocEditor
                snapshot={currentUpdate.snapshot}
                readOnly={!currentUpdate.capabilities?.canEdit}
                onSnapshotChange={(nextSnapshot) =>
                  applySnapshot(currentUpdate.key, nextSnapshot)
                }
              />
            </>
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
  const renameDoc = useDocState((state) => state.renameDoc)
  const fullDoc = docs.find((doc) => doc.key === activeDoc)
  const { open } = useSidebar()
  const isReadOnly =
    Boolean(activeDoc) && capabilities?.canEdit === false && !!fullDoc

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

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
          {isReadOnly ? (
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
    </>
  )
}

function DocsSidebar({ ...props }) {
  const activeDoc = useDocState((state) => state.activeDoc)
  const docs = useDocState((state) => state.docs)
  const selectDoc = useDocState((state) => state.selectDoc)
  const createDoc = useDocState((state) => state.createDoc)

  return (
    <Sidebar {...props}>
      <SidebarHeader className='flex-row border-b h-(--header-height) flex items-center justify-end'>
        <DocJoinDialog />
        <Tooltip>
          <TooltipTrigger>
            <Button
              size='icon-sm'
              variant='outline'
              onClick={() => void createDoc('Untitled')}
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
                    {doc.title || 'Untitled document'}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {docs.length === 0 && (
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

function StatusMessage({ ...props }) {
  return (
    <div
      className='p-5 text-muted-foreground flex items-center justify-center'
      {...props}
    />
  )
}
