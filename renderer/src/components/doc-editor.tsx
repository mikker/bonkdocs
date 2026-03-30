import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@/lib/collaboration-cursor'
import type { Awareness } from 'y-protocols/awareness'
import type { Doc as YDoc } from 'yjs'
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

type EditorUser = {
  name: string
  color: string
  avatarDataUrl?: string | null
}

interface DocEditorProps {
  docKey?: string | null
  doc: YDoc
  awareness?: Awareness | null
  user?: EditorUser | null
  className?: string
  readOnly?: boolean
}

export function DocEditor({
  docKey = null,
  doc,
  awareness = null,
  user = null,
  className,
  readOnly = true
}: DocEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const prevReadOnlyRef = useRef(readOnly)
  const prevCursorUserRef = useRef('')

  const cursorUser = useMemo(
    () => user ?? { name: 'You', color: '#111827' },
    [user]
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            linkOnPaste: true,
            autolink: true
          },
          history: false,
          undoRedo: false
        }),
        Collaboration.configure({
          document: doc
        }),
        ...(awareness
          ? [
              CollaborationCursor.configure({
                provider: { awareness },
                user: cursorUser
              })
            ]
          : [])
      ],
      editable: !readOnly,
      autofocus: true,
      editorProps: {
        attributes: {
          class: 'p-5 focus:outline-none'
        }
      }
    },
    [doc, awareness]
  )

  useEffect(() => {
    if (!editor || !awareness) return
    const next = `${cursorUser.name}:${cursorUser.color}:${cursorUser.avatarDataUrl ?? ''}`
    if (prevCursorUserRef.current === next) return
    prevCursorUserRef.current = next
    const frame = window.requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      try {
        editor.commands.updateUser(cursorUser)
      } catch {}
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [editor, awareness, cursorUser])

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
        'relative grid overflow-y-auto',
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

      <EditorContent
        editor={editor}
        className='grid'
        data-doc-key={docKey ?? undefined}
      />

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
