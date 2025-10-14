import { FormEvent, useEffect, useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDocStore, type DocPairStatus } from '@/state/doc-store'
import { toast } from 'sonner'
import { FileKey2 } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

export function DocJoinDialog() {
  const [open, setOpen] = useState(false)
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
      setOpen(false)
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
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger>
          <DialogTrigger asChild>
            <Button size='sm' variant='outline' className='text-xs'>
              <FileKey2 />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Join via invite</TooltipContent>
      </Tooltip>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Join document</DialogTitle>
          <DialogDescription>
            Paste an invite code to join an existing document.
          </DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={handleSubmit}>
          <div className='space-y-2'>
            <Label htmlFor='doc-join-invite'>Invite code</Label>
            <Input
              id='doc-join-invite'
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
            <Button type='submit' size='sm' disabled={joining}>
              {joining ? 'Joining…' : 'Join document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
