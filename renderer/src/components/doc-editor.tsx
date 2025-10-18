import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

const EMPTY_DOCUMENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
}

interface DocEditorProps {
  snapshot?: any
  className?: string
  readOnly?: boolean
  onSnapshotChange?: (snapshot: any) => void
}

export function DocEditor({
  snapshot,
  className,
  readOnly = true,
  onSnapshotChange
}: DocEditorProps) {
  const applyRef = useRef(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          linkOnPaste: true,
          autolink: true
        }
      })
    ],
    content: snapshot ?? EMPTY_DOCUMENT,
    editable: !readOnly,
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'p-5 focus:outline-none'
      }
    },
    onUpdate: ({ editor }) => {
      if (applyRef.current) {
        applyRef.current = false
        return
      }
      if (readOnly || typeof onSnapshotChange !== 'function') return
      try {
        const json = editor.getJSON()
        onSnapshotChange(json)
      } catch {}
    }
  })

  const bubbleButtonClass = 'px-2 py-1 text-sm rounded-md transition-colors'

  const bubbleActiveClass = 'bg-foreground text-background'
  const bubbleInactiveClass =
    'bg-popover text-foreground hover:bg-muted hover:text-foreground'

  const handleToggleLink = () => {
    if (!editor) return
    const previous = editor.getAttributes('link')?.href || ''
    setLinkValue(previous)
    setLinkDialogOpen(true)
  }

  useEffect(() => {
    if (!editor) return

    const nextContent = snapshot ?? EMPTY_DOCUMENT
    const currentSerialized = JSON.stringify(editor.getJSON())
    const nextSerialized = JSON.stringify(nextContent)
    if (currentSerialized === nextSerialized) {
      editor.setEditable(!readOnly)
      return
    }

    const wasFocused = editor.isFocused
    const { from, to } = editor.state.selection

    applyRef.current = true

    const setContent = () => {
      editor.commands.setContent(nextContent, {
        emitUpdate: false
      })
    }

    try {
      try {
        setContent()
      } catch {
        setContent()
      }

      const docSize = Math.max(0, editor.state.doc.nodeSize - 2)
      const clamp = (value: number) => Math.max(0, Math.min(value, docSize))
      const clampedFrom = clamp(from)
      const clampedTo = clamp(to)

      if (clampedFrom <= clampedTo) {
        if (wasFocused) {
          editor
            .chain()
            .setTextSelection({ from: clampedFrom, to: clampedTo })
            .focus()
            .run()
        } else {
          editor.commands.setTextSelection({ from: clampedFrom, to: clampedTo })
        }
      }
    } finally {
      applyRef.current = false
      editor.setEditable(!readOnly)
    }
  }, [editor, snapshot, readOnly])

  useEffect(() => {
    if (readOnly && linkDialogOpen) {
      setLinkDialogOpen(false)
    }
  }, [readOnly, linkDialogOpen])

  const handleLinkSubmit = () => {
    if (!editor) return
    const href = linkValue.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!href) {
      chain.unsetLink().run()
    } else {
      chain.setLink({ href }).run()
    }
    setLinkDialogOpen(false)
  }

  const handleLinkRemove = () => {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkDialogOpen(false)
  }

  return (
    <div
      className={cn(
        'relative h-full isolate',
        readOnly && 'pointer-events-none',
        className
      )}
    >
      {editor && !readOnly ? (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 150, zIndex: 2000 }}
          shouldShow={({ editor }) =>
            !readOnly &&
            !editor.isDestroyed &&
            editor.isEditable &&
            !editor.state.selection.empty
          }
          className='flex gap-2 rounded-lg border bg-popover p-1 shadow-sm z-30'
        >
          <button
            type='button'
            className={cn(
              bubbleButtonClass,
              editor.isActive('bold') ? bubbleActiveClass : bubbleInactiveClass
            )}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            type='button'
            className={cn(
              bubbleButtonClass,
              editor.isActive('italic')
                ? bubbleActiveClass
                : bubbleInactiveClass
            )}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            type='button'
            className={cn(
              bubbleButtonClass,
              editor.isActive('underline')
                ? bubbleActiveClass
                : bubbleInactiveClass
            )}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            U
          </button>
          <button
            type='button'
            className={cn(
              bubbleButtonClass,
              editor.isActive('strike')
                ? bubbleActiveClass
                : bubbleInactiveClass
            )}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            S
          </button>
          <button
            type='button'
            className={cn(
              bubbleButtonClass,
              editor.isActive('link')
                ? bubbleActiveClass
                : bubbleInactiveClass
            )}
            onClick={handleToggleLink}
          >
            Link
          </button>
        </BubbleMenu>
      ) : null}

      <EditorContent
        editor={editor}
        className={cn(
          'tiptap h-full *:h-full overflow-hidden [&>[class*=ProseMirror]]:overflow-auto',
          readOnly && 'pointer-events-none'
        )}
      />

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>{editor?.isActive('link') ? 'Edit link' : 'Add link'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <Input
              autoFocus
              placeholder='https://example.com'
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleLinkSubmit()
                }
              }}
            />
          </div>
          <DialogFooter className='flex items-center justify-between'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={handleLinkRemove}
              disabled={!editor?.isActive('link')}
            >
              Remove link
            </Button>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setLinkDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type='button' size='sm' onClick={handleLinkSubmit}>
                Apply
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
