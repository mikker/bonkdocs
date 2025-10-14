import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cn } from '@/lib/utils'

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

  const editor = useEditor({
    extensions: [StarterKit],
    content: snapshot ?? EMPTY_DOCUMENT,
    editable: !readOnly,
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'm-5 focus:outline-none'
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

    const nextContent = snapshot ?? EMPTY_DOCUMENT
    applyRef.current = true
    try {
      const current = editor.getJSON()
      if (JSON.stringify(current) !== JSON.stringify(nextContent)) {
        editor.commands.setContent(nextContent, {
          emitUpdate: false
        })
      } else {
        applyRef.current = false
      }
    } catch {
      editor.commands.setContent(nextContent, {
        emitUpdate: false
      })
    }
    editor.setEditable(!readOnly)
  }, [editor, snapshot, readOnly])

  return (
    <div className={cn('overflow-auto', className)}>
      <EditorContent
        editor={editor}
        className={cn('tiptap', readOnly && 'pointer-events-none')}
      />
    </div>
  )
}
