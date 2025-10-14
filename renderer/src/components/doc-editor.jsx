import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cn } from '@/lib/utils'

const EMPTY_DOCUMENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
}

export function DocEditor({
  snapshot,
  className,
  readOnly = true,
  onSnapshotChange
}) {
  const applyRef = useRef(false)

  const editor = useEditor({
    extensions: [StarterKit],
    content: snapshot ?? EMPTY_DOCUMENT,
    editable: !readOnly,
    autofocus: false,
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

    const nextContent = snapshot ?? EMPTY_DOCUMENT
    applyRef.current = true
    try {
      const current = editor.getJSON()
      if (JSON.stringify(current) !== JSON.stringify(nextContent)) {
        editor.commands.setContent(nextContent, false, {
          preserveWhitespace: false
        })
      } else {
        applyRef.current = false
      }
    } catch {
      editor.commands.setContent(nextContent, false, {
        preserveWhitespace: false
      })
    }
    editor.setEditable(!readOnly)
  }, [editor, snapshot, readOnly])

  return (
    <div
      className={cn(
        'bg-card text-card-foreground border border-border rounded-lg p-4 min-h-[300px] overflow-auto shadow-sm',
        className
      )}
    >
      <EditorContent
        editor={editor}
        className={cn(
          'tiptap text-base leading-relaxed',
          readOnly && 'pointer-events-none'
        )}
      />
    </div>
  )
}
