import { useEffect } from 'react'
import { TitleBar, TitleBarTitle } from './components/title-bar'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { DocEditor } from '@/components/doc-editor'
import { DocInvitesDialog } from '@/components/doc-invites-dialog'
import { DocJoinDialog } from '@/components/doc-join-dialog'
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
import { FilePlus2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

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
          {currentUpdate ? (
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
            <StatusMessage>Select a document to view details.</StatusMessage>
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
  const fullDoc = docs.find((doc) => doc.key === activeDoc)
  const { open } = useSidebar()
  const isReadOnly =
    Boolean(activeDoc) && capabilities?.canEdit === false && !!fullDoc

  return (
    <TitleBar
      data-sidebar-open={open}
      className='border-b w-full flex gap-2 items-center h-(--header-height) data-[sidebar-open=true]:pl-3 pl-(--window-ctrl-width)'
    >
      <SidebarTrigger className='' />
      <TitleBarTitle className='flex flex-1 flex-wrap items-center gap-2'>
        {fullDoc?.title ? (
          <span>{fullDoc.title}</span>
        ) : (
          <span className='text-muted-foreground'>Pear Docs</span>
        )}
        {isReadOnly ? (
          <Badge className='px-2 py-0.5 text-[0.65rem] uppercase tracking-wide'>
            Read-only
          </Badge>
        ) : null}
      </TitleBarTitle>
      <DocInvitesDialog />
    </TitleBar>
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
