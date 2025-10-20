import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { DocConflictState } from '@/state/doc-store'

type DocConflictViewProps = {
  docKey: string
  conflict: DocConflictState
  onResync: () => Promise<void> | void
  onFork: () => Promise<void> | void
}

export function DocConflictView({
  docKey,
  conflict,
  onResync,
  onFork
}: DocConflictViewProps) {
  const [resyncing, setResyncing] = useState(false)
  const [forking, setForking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResync = async () => {
    if (resyncing || forking) return
    setError(null)
    setResyncing(true)
    try {
      await Promise.resolve(onResync())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setResyncing(false)
    }
  }

  const handleFork = async () => {
    if (resyncing || forking) return
    setError(null)
    setForking(true)
    try {
      await Promise.resolve(onFork())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setForking(false)
    }
  }

  const attempted = conflict.attemptedRevision
  const existing = conflict.existingRevision
  const base = conflict.baseRevision
  const clientId = conflict.clientId
    ? `${conflict.clientId.slice(0, 8)}…`
    : null

  return (
    <div className='flex h-full flex-col items-center justify-center gap-6 px-8 text-center'>
      <div className='flex flex-col items-center gap-4'>
        <AlertTriangle className='h-12 w-12 text-destructive' />
        <div className='space-y-2 max-w-xl'>
          <h2 className='text-xl font-semibold'>Sync conflict detected</h2>
          <p className='text-xs uppercase tracking-wide text-muted-foreground'>
            Doc {docKey}
          </p>
          <p className='text-muted-foreground text-sm md:text-base'>
            {conflict.message}
          </p>
          <p className='text-xs text-muted-foreground md:text-sm'>
            Attempted revision {attempted} based on {base}; document already
            contains revision {existing}.
            {clientId ? ` Conflicting client ${clientId}.` : ''}
          </p>
        </div>
      </div>

      {error ? <p className='text-sm text-destructive'>{error}</p> : null}

      <div className='flex flex-wrap items-center justify-center gap-3'>
        <Button onClick={handleResync} disabled={resyncing || forking}>
          {resyncing ? 'Resyncing…' : 'Retry sync'}
        </Button>
        <Button
          variant='outline'
          onClick={handleFork}
          disabled={resyncing || forking}
        >
          {forking ? 'Forking…' : 'Fork document'}
        </Button>
      </div>
    </div>
  )
}
