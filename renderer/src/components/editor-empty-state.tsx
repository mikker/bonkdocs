import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileKey2, FilePlus2 } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useDocStore, type DocPairStatus } from '@/state/doc-store'
import { toast } from 'sonner'
import Bonk from './illus-bonk'

export function EditorEmptyState() {
  const [joinDialogOpen, setJoinDialogOpen] = useState(false)
  const createDoc = useDocStore((state) => state.createDoc)

  return (
    <div className='flex items-center justify-center h-full p-8'>
      <div className='flex flex-col items-center gap-6 max-w-md text-center'>
        <div className='size-64 rounded-2xl bg-muted flex items-center justify-center'>
          <Bonk className='size-full' />
        </div>

        <div className='space-y-2'>
          <h2 className='text-xl font-semibold'>Create or join a doc</h2>
          <p className='text-sm text-muted-foreground'>
            Docs can be fun on your own but they're even better with friends
          </p>
        </div>

        <div className='flex gap-3'>
          <Button onClick={() => void createDoc('Untitled')} size='lg'>
            <FilePlus2 />
            Create doc
          </Button>
          <Button
            variant='outline'
            size='lg'
            onClick={() => setJoinDialogOpen(true)}
          >
            <FileKey2 />
            Join doc
          </Button>
        </div>
      </div>

      <JoinDialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen} />
    </div>
  )
}

function JoinDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [invite, setInvite] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [status, setStatus] = useState<DocPairStatus | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const joinDoc = useDocStore((state) => state.joinDoc)

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort()
      controllerRef.current = null
      setInvite('')
      setError(null)
      setJoining(false)
      setStatus(null)
    }
  }, [open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmed = invite.trim()
    if (!trimmed) {
      setError('Enter an invite code to join a document.')
      return
    }

    setJoining(true)
    setError(null)
    setStatus(null)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      await joinDoc(trimmed, {
        onStatus: (next) => setStatus(next),
        signal: controller.signal
      })
      toast('Joined document', {
        description: 'The document is now available in your list.'
      })
      onOpenChange(false)
    } catch (err) {
      if (controller.signal.aborted) {
        return
      }
      const message =
        err instanceof Error ? err.message : 'Failed to join document'
      setError(message)
    } finally {
      controllerRef.current = null
      setJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Join document</DialogTitle>
          <DialogDescription>
            Paste an invite code to join an existing document.
          </DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='space-y-2'>
            <Label htmlFor='empty-join-invite'>Invite code</Label>
            <Input
              id='empty-join-invite'
              value={invite}
              autoFocus
              placeholder='pear_doc_…'
              onChange={(event) => setInvite(event.target.value)}
              disabled={joining}
            />
            {error ? <p className='text-sm text-destructive'>{error}</p> : null}
            {!error && status?.message ? (
              <p className='text-sm text-muted-foreground'>
                {status.progress != null
                  ? `${status.message} (${Math.min(100, Math.max(0, Math.round(status.progress)))}%)`
                  : status.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              disabled={joining}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={joining}>
              {joining ? 'Joining…' : 'Join'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
