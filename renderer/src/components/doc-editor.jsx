import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { cn } from '@/lib/utils'

const EMPTY_DOCUMENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '' }]
    }
  ]
}

export function DocEditor({ snapshot, className, readOnly = true }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: snapshot ?? EMPTY_DOCUMENT,
    editable: !readOnly,
    autofocus: false
  })

  useEffect(() => {
    if (!editor) return

    const nextContent = snapshot ?? EMPTY_DOCUMENT
    try {
      const current = editor.getJSON()
      if (JSON.stringify(current) !== JSON.stringify(nextContent)) {
        editor.commands.setContent(nextContent, false, {
          preserveWhitespace: false
        })
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
