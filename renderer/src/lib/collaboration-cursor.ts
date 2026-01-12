import { Extension } from '@tiptap/core'
import type { DecorationAttrs } from '@tiptap/pm/view'
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'

type CollaborationCursorStorage = {
  users: { clientId: number; [key: string]: any }[]
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
      users: []
    }
  },

  addCommands() {
    return {
      updateUser: (attributes) => () => {
        const awareness = this.options.provider?.awareness

        if (!awareness) return false

        this.options.user = attributes
        awareness.setLocalStateField('user', this.options.user)

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

    awareness.setLocalStateField('user', this.options.user)

    this.storage.users = awarenessStatesToArray(awareness.getStates())

    awareness.on('update', () => {
      this.storage.users = awarenessStatesToArray(awareness.getStates())
    })

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: this.options.render,
        selectionBuilder: this.options.selectionRender
      })
    ]
  }
})

export default CollaborationCursor
