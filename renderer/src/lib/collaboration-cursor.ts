import { Extension } from '@tiptap/core'
import type { DecorationAttrs } from '@tiptap/pm/view'
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'

type CollaborationCursorStorage = {
  users: { clientId: number; [key: string]: any }[]
  awareness: Awareness | null
  awarenessListener: (() => void) | null
}

export interface CollaborationCursorOptions {
  provider: { awareness: Awareness } | null
  user: Record<string, any>
  render: (user: Record<string, any>) => HTMLElement
  selectionRender: (user: Record<string, any>) => DecorationAttrs
  onUpdate: (users: { clientId: number; [key: string]: any }[]) => null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collaborationCursor: {
      updateUser: (attributes: Record<string, any>) => ReturnType
      user: (attributes: Record<string, any>) => ReturnType
    }
  }
}

const awarenessStatesToArray = (states: Map<number, Record<string, any>>) => {
  return Array.from(states.entries()).map(([key, value]) => {
    return {
      clientId: key,
      ...(value?.user ?? {})
    }
  })
}

const defaultOnUpdate = () => null

function sameUser(
  a: Record<string, any> | null | undefined,
  b: Record<string, any> | null | undefined
) {
  if (a === b) return true
  if (!a || !b) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function setAwarenessUser(awareness: Awareness, user: Record<string, any>) {
  const local = awareness.getLocalState()
  const current = local && typeof local === 'object' ? local.user : undefined
  if (sameUser(current, user)) return
  awareness.setLocalStateField('user', user)
}

export const CollaborationCursor = Extension.create<
  CollaborationCursorOptions,
  CollaborationCursorStorage
>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null,
      user: {
        name: null,
        color: null
      },
      render: (user) => {
        const cursor = document.createElement('span')

        cursor.classList.add('collaboration-cursor__caret')
        cursor.setAttribute('style', `border-color: ${user.color}`)

        const label = document.createElement('div')

        label.classList.add('collaboration-cursor__label')
        label.setAttribute('style', `background-color: ${user.color}`)
        label.insertBefore(document.createTextNode(user.name), null)
        cursor.insertBefore(label, null)

        return cursor
      },
      selectionRender: defaultSelectionBuilder,
      onUpdate: defaultOnUpdate
    }
  },

  onCreate() {
    if (this.options.onUpdate !== defaultOnUpdate) {
      console.warn(
        '[tiptap warn]: DEPRECATED: The "onUpdate" option is deprecated. Please use `editor.storage.collaborationCursor.users` instead.'
      )
    }
  },

  addStorage() {
    return {
      users: [],
      awareness: null,
      awarenessListener: null
    }
  },

  addCommands() {
    return {
      updateUser: (attributes) => () => {
        const awareness = this.options.provider?.awareness

        if (!awareness) return false

        this.options.user = attributes
        setAwarenessUser(awareness, this.options.user)

        return true
      },
      user:
        (attributes) =>
        ({ editor }) => {
          console.warn(
            '[tiptap warn]: DEPRECATED: The "user" command is deprecated. Please use "updateUser" instead.'
          )

          return editor.commands.updateUser(attributes)
        }
    }
  },

  addProseMirrorPlugins() {
    const awareness = this.options.provider?.awareness

    if (!awareness) return []

    setAwarenessUser(awareness, this.options.user)

    this.storage.awareness = awareness
    this.storage.users = awarenessStatesToArray(awareness.getStates())

    const handleUpdate = () => {
      this.storage.users = awarenessStatesToArray(awareness.getStates())
    }
    this.storage.awarenessListener = handleUpdate
    awareness.on('update', handleUpdate)

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: this.options.render,
        selectionBuilder: this.options.selectionRender
      })
    ]
  },

  onDestroy() {
    const awareness = this.storage.awareness
    const listener = this.storage.awarenessListener
    if (awareness && listener) {
      awareness.off('update', listener)
    }
    this.storage.awareness = null
    this.storage.awarenessListener = null
  }
})

export default CollaborationCursor
