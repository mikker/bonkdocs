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
  docKey: string
  snapshot?: any
  className?: string
  readOnly?: boolean
  onSnapshotChange?: (snapshot: any) => void
}

export function DocEditor({
  docKey,
  snapshot,
  className,
  readOnly = true,
  onSnapshotChange
}: DocEditorProps) {
  const applyRef = useRef(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const prevReadOnlyRef = useRef(readOnly)

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

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (readOnly && linkDialogOpen) {
      setLinkDialogOpen(false)
    }
  }, [readOnly, linkDialogOpen])

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
    const previous = prevReadOnlyRef.current
    prevReadOnlyRef.current = readOnly
    if (!editor) return
    if (readOnly && previous === false) {
      editor.commands.blur()
    }
  }, [readOnly, editor])

  const handleToggleLink = () => {
    if (!editor) return
    const previous = editor.getAttributes('link')?.href || ''
    setLinkValue(previous)
    setLinkDialogOpen(true)
  }

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
              'px-2 py-1 text-sm rounded-md transition-colors',
              editor.isActive('bold')
                ? 'bg-foreground text-background'
                : 'bg-popover text-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            type='button'
            className={cn(
              'px-2 py-1 text-sm rounded-md transition-colors',
              editor.isActive('italic')
                ? 'bg-foreground text-background'
                : 'bg-popover text-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            type='button'
            className={cn(
              'px-2 py-1 text-sm rounded-md transition-colors',
              editor.isActive('underline')
                ? 'bg-foreground text-background'
                : 'bg-popover text-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={() => editor.chain().focus().toggleUnderline?.().run?.()}
          >
            U
          </button>
          <button
            type='button'
            className={cn(
              'px-2 py-1 text-sm rounded-md transition-colors',
              editor.isActive('strike')
                ? 'bg-foreground text-background'
                : 'bg-popover text-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            S
          </button>
          <button
            type='button'
            className={cn(
              'px-2 py-1 text-sm rounded-md transition-colors',
              editor.isActive('link')
                ? 'bg-foreground text-background'
                : 'bg-popover text-foreground hover:bg-muted hover:text-foreground'
            )}
            onClick={handleToggleLink}
          >
            Link
          </button>
        </BubbleMenu>
      ) : null}

      <EditorContent editor={editor} className='h-full' data-doc-key={docKey} />

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>
              {editor?.isActive('link') ? 'Edit link' : 'Add link'}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <Input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder='https://example.com'
            />
            <DialogFooter className='gap-2 flex justify-end'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setLinkDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type='button' size='sm' onClick={handleLinkRemove}>
                Remove
              </Button>
              <Button type='button' size='sm' onClick={handleLinkSubmit}>
                Apply
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
