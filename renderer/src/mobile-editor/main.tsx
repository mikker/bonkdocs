import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@/lib/collaboration-cursor'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from 'y-protocols/awareness'

const REMOTE_ORIGIN = 'remote'

type EditorUser = {
  name: string
  color: string
  key: string
}

type EditorMeta = {
  key: string | null
  title: string
  revision: number
  updatedAt: number | null
  canEdit: boolean
  lockedAt: number | null
  roles: string[]
  writerKey: string | null
}

type IncomingDocUpdate = {
  key?: string
  title?: string | null
  revision?: number
  updatedAt?: number | null
  writerKey?: string | null
  lockedAt?: number | null
  capabilities?: {
    canEdit?: boolean
    roles?: string[]
  } | null
  syncUpdate?: number[] | Record<string, unknown> | null
  awareness?: number[] | Record<string, unknown> | null
  updates?: Array<{
    data?: number[] | Record<string, unknown> | null
  }> | null
}

type IncomingMessage =
  | { type: 'doc-update'; payload: IncomingDocUpdate }
  | {
      type: 'set-user'
      user: EditorUser
    }

type OutgoingMessage =
  | { type: 'ready' }
  | { type: 'apply-updates'; key: string; update: number[] }
  | { type: 'apply-awareness'; key: string; update: number[] }

function postMessage(message: OutgoingMessage) {
  const target = window.ReactNativeWebView
  if (!target || typeof target.postMessage !== 'function') return
  target.postMessage(JSON.stringify(message))
}

function asUint8Array(
  value: number[] | Record<string, unknown> | Uint8Array | ArrayBuffer | null | undefined
) {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) {
    return value.length > 0 ? Uint8Array.from(value) : null
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.data)) {
      return value.data.length > 0 ? Uint8Array.from(value.data) : null
    }
    const numericEntries = Object.entries(value)
      .filter(([key, entry]) => /^\d+$/.test(key) && typeof entry === 'number')
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([, entry]) => entry)
    return numericEntries.length > 0 ? Uint8Array.from(numericEntries) : null
  }
  return null
}

function shortLabel(value: string) {
  return value.slice(0, 5)
}

function colorFromKey(key: string) {
  const colors = [
    '#2563eb',
    '#dc2626',
    '#16a34a',
    '#9333ea',
    '#ea580c',
    '#0f766e',
    '#0f172a'
  ]

  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash + key.charCodeAt(index) * 17) % 9973
  }

  return colors[hash % colors.length]
}

function userFromWriterKey(writerKey: string | null | undefined): EditorUser {
  const key = typeof writerKey === 'string' ? writerKey.trim() : ''
  if (!key) {
    return {
      name: 'You',
      color: '#111827',
      key: ''
    }
  }

  return {
    name: shortLabel(key),
    color: colorFromKey(key),
    key
  }
}

function formatUpdatedAt(value: number | null) {
  if (!value) return 'Waiting for sync'

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    }).format(new Date(value))
  } catch {
    return 'Recently updated'
  }
}

function ToolbarButton({
  active = false,
  label,
  onClick
}: {
  active?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      style={{
        appearance: 'none',
        border: '1px solid #dadada',
        background: active ? '#1a1a1a' : '#ffffff',
        color: active ? '#ffffff' : '#1a1a1a',
        borderRadius: 10,
        padding: '8px 10px',
        fontSize: 14,
        fontWeight: 600
      }}
    >
      {label}
    </button>
  )
}

function App() {
  const docRef = useRef<Y.Doc | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)

  if (!docRef.current) {
    docRef.current = new Y.Doc()
  }

  if (!awarenessRef.current) {
    awarenessRef.current = new Awareness(docRef.current)
  }

  const doc = docRef.current
  const awareness = awarenessRef.current

  const [meta, setMeta] = useState<EditorMeta>({
    key: null,
    title: 'Untitled document',
    revision: 0,
    updatedAt: null,
    canEdit: false,
    lockedAt: null,
    roles: [],
    writerKey: null
  })
  const [user, setUser] = useState<EditorUser>({
    name: 'You',
    color: '#111827',
    key: ''
  })
  const [connected, setConnected] = useState(false)

  const editable = meta.canEdit && !meta.lockedAt
  const cursorUser = useMemo(
    () => ({
      name: user.name,
      color: user.color
    }),
    [user]
  )

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          history: false,
          undoRedo: false
        }),
        Collaboration.configure({
          document: doc
        }),
        CollaborationCursor.configure({
          provider: { awareness },
          user: cursorUser
        })
      ],
      editable,
      autofocus: 'end',
      editorProps: {
        attributes: {
          class: 'mobile-editor-content'
        }
      }
    },
    [doc, awareness]
  )

  useEffect(() => {
    awareness.setLocalStateField('user', cursorUser)
  }, [awareness, cursorUser])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || !meta.key) return
      postMessage({
        type: 'apply-updates',
        key: meta.key,
        update: Array.from(update)
      })
    }

    const handleAwarenessUpdate = (
      {
        added,
        updated,
        removed
      }: {
        added: number[]
        updated: number[]
        removed: number[]
      },
      origin: unknown
    ) => {
      if (origin === REMOTE_ORIGIN || !meta.key) return
      const changed = [...added, ...updated, ...removed]
      if (changed.length === 0) return
      const update = encodeAwarenessUpdate(awareness, changed)
      postMessage({
        type: 'apply-awareness',
        key: meta.key,
        update: Array.from(update)
      })
    }

    doc.on('update', handleDocUpdate)
    awareness.on('update', handleAwarenessUpdate)

    return () => {
      doc.off('update', handleDocUpdate)
      awareness.off('update', handleAwarenessUpdate)
    }
  }, [awareness, doc, meta.key])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<string>) => {
      let payload: IncomingMessage | null = null

      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (!payload) return

      if (payload.type === 'set-user') {
        setUser(payload.user)
        return
      }

      if (payload.type !== 'doc-update') return

      const next = payload.payload
      if (!next) return

      const syncUpdate = asUint8Array(next.syncUpdate)
      if (syncUpdate) {
        Y.applyUpdate(doc, syncUpdate, REMOTE_ORIGIN)
      }

      if (Array.isArray(next.updates)) {
        for (const entry of next.updates) {
          const update = asUint8Array(entry?.data ?? null)
          if (update) {
            Y.applyUpdate(doc, update, REMOTE_ORIGIN)
          }
        }
      }

      const awarenessUpdate = asUint8Array(next.awareness)
      if (awarenessUpdate) {
        applyAwarenessUpdate(awareness, awarenessUpdate, REMOTE_ORIGIN)
      }

      const roles = Array.isArray(next.capabilities?.roles)
        ? next.capabilities?.roles.filter(
            (role): role is string => typeof role === 'string' && role.length > 0
          )
        : []

      setMeta((current) => ({
        key: typeof next.key === 'string' ? next.key : current.key,
        title:
          typeof next.title === 'string' && next.title.trim().length > 0
            ? next.title
            : current.title,
        revision:
          typeof next.revision === 'number' ? next.revision : current.revision,
        updatedAt:
          typeof next.updatedAt === 'number' ? next.updatedAt : current.updatedAt,
        canEdit:
          next.capabilities?.canEdit === true ||
          (next.capabilities?.canEdit === false ? false : current.canEdit),
        lockedAt:
          typeof next.lockedAt === 'number'
            ? next.lockedAt
            : next.lockedAt === null
              ? null
              : current.lockedAt,
        roles: roles.length > 0 ? roles : current.roles,
        writerKey:
          typeof next.writerKey === 'string' ? next.writerKey : current.writerKey
      }))

      if (typeof next.writerKey === 'string' && next.writerKey.length > 0) {
        setUser(userFromWriterKey(next.writerKey))
      }

      setConnected(true)
    }

    window.addEventListener('message', handleMessage)
    document.addEventListener('message', handleMessage as EventListener)
    postMessage({ type: 'ready' })

    return () => {
      window.removeEventListener('message', handleMessage)
      document.removeEventListener('message', handleMessage as EventListener)
    }
  }, [awareness, doc])

  return (
    <>
      <style>{`
        :root {
          color-scheme: light;
          --ink: #1a1a1a;
          --muted: #707070;
          --edge: #e5e5e5;
          --paper: #ffffff;
          --panel: #f7f7f7;
        }
        * {
          box-sizing: border-box;
        }
        html, body, #root {
          margin: 0;
          min-height: 100%;
          background: var(--panel);
          color: var(--ink);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        button, input, textarea {
          font: inherit;
        }
        .mobile-editor-shell {
          min-height: 100vh;
          display: grid;
          grid-template-rows: auto auto 1fr;
          gap: 12px;
          padding: 16px;
        }
        .mobile-editor-panel {
          background: var(--paper);
          border: 1px solid var(--edge);
          border-radius: 18px;
        }
        .mobile-editor-header {
          padding: 16px 16px 12px;
          display: grid;
          gap: 4px;
        }
        .mobile-editor-title {
          margin: 0;
          font-size: 22px;
          line-height: 1.15;
        }
        .mobile-editor-subtitle {
          margin: 0;
          font-size: 14px;
          color: var(--muted);
        }
        .mobile-editor-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 16px 12px;
        }
        .mobile-editor-frame {
          overflow: hidden;
        }
        .mobile-editor-content {
          min-height: 52vh;
          padding: 16px;
          outline: none;
          font-size: 18px;
          line-height: 1.6;
          color: var(--ink);
          white-space: pre-wrap;
        }
        .mobile-editor-content > *:first-child {
          margin-top: 0;
        }
        .mobile-editor-content > *:last-child {
          margin-bottom: 0;
        }
        .mobile-editor-content p.is-editor-empty:first-child::before {
          color: #a0a0a0;
          content: "Start writing";
          float: left;
          height: 0;
          pointer-events: none;
        }
        .mobile-editor-content ul,
        .mobile-editor-content ol {
          padding-left: 1.4em;
        }
        .mobile-editor-content blockquote {
          margin-left: 0;
          padding-left: 12px;
          border-left: 3px solid #d6d6d6;
          color: #4b4b4b;
        }
        .mobile-editor-content h1,
        .mobile-editor-content h2,
        .mobile-editor-content h3 {
          line-height: 1.2;
        }
        .collaboration-cursor__caret {
          border-left: 1px solid;
          border-right: 1px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-cursor__label {
          border-radius: 999px;
          color: #fff;
          font-size: 12px;
          font-style: normal;
          font-weight: 600;
          left: -1px;
          line-height: 1;
          padding: 0.2rem 0.45rem;
          position: absolute;
          top: -1.4em;
          user-select: none;
          white-space: nowrap;
        }
      `}</style>
      <div className='mobile-editor-shell'>
        <section className='mobile-editor-panel'>
          <div className='mobile-editor-header'>
            <h1 className='mobile-editor-title'>{meta.title}</h1>
            <p className='mobile-editor-subtitle'>
              {connected
                ? `${editable ? 'Editable' : 'Read only'} • Rev ${meta.revision} • ${formatUpdatedAt(meta.updatedAt)}`
                : 'Connecting to Bonk Docs…'}
            </p>
          </div>
          {editable ? (
            <div className='mobile-editor-toolbar'>
              <ToolbarButton
                label='Bold'
                active={editor?.isActive('bold') === true}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <ToolbarButton
                label='Italic'
                active={editor?.isActive('italic') === true}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
              <ToolbarButton
                label='Bullet'
                active={editor?.isActive('bulletList') === true}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              />
              <ToolbarButton
                label='Numbered'
                active={editor?.isActive('orderedList') === true}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              />
              <ToolbarButton
                label='Quote'
                active={editor?.isActive('blockquote') === true}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              />
            </div>
          ) : null}
        </section>
        <section className='mobile-editor-panel mobile-editor-frame'>
          <EditorContent editor={editor} />
        </section>
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
