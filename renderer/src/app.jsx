import { useEffect, useState } from 'react'
import { TitleBar, TitleBarTitle } from './components/title-bar'
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

      <section className='p-4 space-y-4'>
        <div className='flex gap-2 items-end'>
          <label className='flex flex-col text-sm font-medium text-slate-200 gap-1'>
            New document title
            <input
              type='text'
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              className='bg-slate-950/40 border border-slate-800 rounded px-2 py-1 text-base text-slate-50'
              placeholder='Untitled document'
            />
          </label>
          <button
            type='button'
            className='px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded'
            onClick={() => {
              void createDoc(newTitle.trim() || undefined)
              setNewTitle('')
            }}
          >
            Create Doc
          </button>
          <button
            type='button'
            className='px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded'
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>

        {loading ? <p>Loading documents…</p> : null}
        {error ? <p className='text-red-400'>{error}</p> : null}

        <div className='grid grid-cols-[220px_1fr] gap-6'>
          <aside className='border border-slate-800 rounded p-3 space-y-2 bg-slate-950/50 max-h-[70vh] overflow-auto'>
            <h2 className='text-sm font-semibold text-slate-300 uppercase tracking-wide'>
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
                    <button
                      type='button'
                      className={`w-full text-left rounded px-2 py-1 text-sm ${
                        selected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-900 text-slate-200'
                      }`}
                      onClick={() => void selectDoc(doc.key)}
                    >
                      <span className='block font-medium'>
                        {doc.title || 'Untitled document'}
                      </span>
                      <span className='block text-xs opacity-70 truncate'>
                        {doc.key}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <section className='border border-slate-800 rounded p-4 bg-slate-950/50 min-h-[200px]'>
            {currentUpdate ? (
              <div className='space-y-2'>
                <h2 className='text-xl font-semibold text-slate-100'>
                  {currentUpdate.title || 'Untitled document'}
                </h2>
                <p className='text-sm text-slate-300'>
                  Revision: {currentUpdate.revision}
                </p>
                <p className='text-sm text-slate-400'>
                  Key: {currentUpdate.key}
                </p>
                {currentUpdate.updatedAt ? (
                  <p className='text-xs text-slate-500'>
                    Updated at{' '}
                    {new Date(currentUpdate.updatedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : activeDoc ? (
              <p className='text-slate-400'>Waiting for snapshot…</p>
            ) : (
              <p className='text-slate-400'>
                Select a document to view details.
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}
