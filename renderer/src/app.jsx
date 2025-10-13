import { useEffect, useState } from 'react'
import { TitleBar, TitleBarTitle } from './components/title-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Toaster } from '@/components/ui/sonner'
import { useDocStore } from './state/doc-store'

function useDocState(selector) {
  return useDocStore(selector)
}

export function App() {
  const initialize = useDocState((state) => state.initialize)
  const docs = useDocState((state) => state.docs)
  const activeDoc = useDocState((state) => state.activeDoc)
  const currentUpdate = useDocState((state) => state.currentUpdate)
  const loading = useDocState((state) => state.loading)
  const error = useDocState((state) => state.error)
  const selectDoc = useDocState((state) => state.selectDoc)
  const createDoc = useDocState((state) => state.createDoc)
  const refresh = useDocState((state) => state.refresh)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <main className='overflow-hidden h-lvh'>
      <TitleBar>
        <TitleBarTitle>Pear Docs</TitleBarTitle>
      </TitleBar>

      <section className='p-6 space-y-6'>
        <div className='flex flex-wrap gap-3 items-end'>
          <label className='flex w-72 flex-col gap-1 text-sm font-medium text-muted-foreground'>
            New document title
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder='Untitled document'
            />
          </label>
          <div className='flex gap-2'>
            <Button
              onClick={() => {
                void createDoc(newTitle.trim() || undefined)
                setNewTitle('')
              }}
            >
              Create Doc
            </Button>
            <Button variant='secondary' onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? <p>Loading documents…</p> : null}
        {error ? <p className='text-red-400'>{error}</p> : null}

        <div className='grid grid-cols-[220px_1fr] gap-6'>
          <aside className='border border-border rounded-lg bg-card p-3 space-y-3 max-h-[70vh] overflow-auto'>
            <h2 className='text-xs font-semibold text-muted-foreground uppercase tracking-widest'>
              Documents
            </h2>
            {docs.length === 0 ? (
              <p className='text-slate-500 text-sm'>No docs yet.</p>
            ) : null}
            <ul className='space-y-1'>
              {docs.map((doc) => {
                const selected = doc.key === activeDoc
                return (
                  <li key={doc.key}>
                    <Button
                      variant={selected ? 'primary' : 'ghost'}
                      className='w-full justify-start text-left'
                      onClick={() => void selectDoc(doc.key)}
                    >
                      <span className='block text-sm font-medium'>
                        {doc.title || 'Untitled document'}
                      </span>
                      <span className='block text-xs opacity-70 truncate font-normal'>
                        {doc.key}
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <section className='border border-border rounded-lg bg-card p-6 min-h-[200px] space-y-3'>
            {currentUpdate ? (
              <div className='space-y-2'>
                <h2 className='text-xl font-semibold text-foreground'>
                  {currentUpdate.title || 'Untitled document'}
                </h2>
                <p className='text-sm text-muted-foreground'>
                  Revision: {currentUpdate.revision}
                </p>
                <p className='text-sm text-muted-foreground'>
                  Key: {currentUpdate.key}
                </p>
                {currentUpdate.updatedAt ? (
                  <p className='text-xs text-muted-foreground'>
                    Updated at{' '}
                    {new Date(currentUpdate.updatedAt).toLocaleString()}
                  </p>
                ) : null}
                <Separator />
                <p className='text-xs text-muted-foreground'>
                  Multiplayer editing coming soon. This panel reflects the
                  latest snapshot streamed from the Pear docs worker.
                </p>
              </div>
            ) : activeDoc ? (
              <p className='text-muted-foreground'>Waiting for snapshot…</p>
            ) : (
              <p className='text-muted-foreground'>
                Select a document to view details.
              </p>
            )}
          </section>
        </div>
      </section>
      <Toaster position='top-right' richColors closeButton />
    </main>
  )
}
