import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import {
  applyDocAwareness,
  applyDocUpdates,
  serializeDocUpdate,
  watchDoc,
  type MobileDocView
} from '../lib/doc-rpc'
import { editorWebBundle } from '../generated/editor-web-bundle'

type DocSurfaceProps = {
  doc: MobileDocView
}

type EventListener = (...args: any[]) => void
type RpcStream = {
  on: (event: string, listener: EventListener) => void
  off?: (event: string, listener: EventListener) => void
  removeListener?: (event: string, listener: EventListener) => void
  destroy?: () => void
  destroyed?: boolean
}

type WebBridgeMessage =
  | { type: 'ready' }
  | { type: 'apply-updates'; key: string; update: number[] }
  | { type: 'apply-awareness'; key: string; update: number[] }

function detachStreamListener(
  stream: RpcStream,
  event: string,
  listener: EventListener
) {
  if (typeof stream.off === 'function') {
    stream.off(event, listener)
    return
  }

  if (typeof stream.removeListener === 'function') {
    stream.removeListener(event, listener)
  }
}

function disposeStream(stream: RpcStream | null) {
  if (!stream || stream.destroyed) return
  try {
    stream.destroy?.()
  } catch {}
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

function userMessage(writerKey: string | null | undefined) {
  const key = typeof writerKey === 'string' ? writerKey.trim() : ''
  if (!key) {
    return {
      type: 'set-user' as const,
      user: {
        name: 'You',
        color: '#111827',
        key: ''
      }
    }
  }

  return {
    type: 'set-user' as const,
    user: {
      name: shortLabel(key),
      color: colorFromKey(key),
      key
    }
  }
}

function htmlDocument() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  </head>
  <body>
    <div id="root"></div>
    <script>${editorWebBundle}</script>
  </body>
</html>`
}

export function DocSurface({ doc }: DocSurfaceProps) {
  const webViewRef = useRef<WebView>(null)
  const streamRef = useRef<RpcStream | null>(null)
  const readyRef = useRef(false)
  const pendingRef = useRef<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const source = useMemo(() => ({ html: htmlDocument() }), [])

  const postToEditor = (payload: Record<string, unknown>) => {
    const message = JSON.stringify(payload)

    if (!readyRef.current) {
      pendingRef.current.push(message)
      return
    }

    webViewRef.current?.postMessage(message)
  }

  useEffect(() => {
    readyRef.current = false
    pendingRef.current = []
    setLoading(true)
    setError(null)

    const stream = watchDoc(doc.key) as RpcStream
    streamRef.current = stream

    const handleData = (payload: unknown) => {
      const serialized = serializeDocUpdate(payload)
      if (!serialized) return
      setLoading(false)
      setError(null)

      postToEditor({
        type: 'doc-update',
        payload: serialized
      })

      if (serialized.writerKey) {
        postToEditor(userMessage(serialized.writerKey))
      }
    }

    const handleFailure = (nextError: unknown) => {
      setLoading(false)
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Lost document editor connection'
      )
    }

    stream.on('data', handleData)
    stream.on('error', handleFailure)
    stream.on('close', handleFailure)

    return () => {
      detachStreamListener(stream, 'data', handleData)
      detachStreamListener(stream, 'error', handleFailure)
      detachStreamListener(stream, 'close', handleFailure)
      if (streamRef.current === stream) {
        streamRef.current = null
      }
      disposeStream(stream)
    }
  }, [doc.key])

  const handleMessage = async (event: {
    nativeEvent: { data?: string | null }
  }) => {
    const data = event.nativeEvent.data
    if (!data) return

    let payload: WebBridgeMessage | null = null

    try {
      payload = JSON.parse(data)
    } catch {
      return
    }

    if (!payload) return

    if (payload.type === 'ready') {
      readyRef.current = true
      postToEditor({
        type: 'doc-update',
        payload: {
          key: doc.key,
          title: doc.title,
          revision: doc.revision,
          updatedAt: doc.updatedAt,
          lockedAt: doc.lockedAt,
          lockedBy: doc.lockedBy,
          capabilities: {
            canEdit: doc.canEdit,
            roles: doc.roles
          }
        }
      })

      while (pendingRef.current.length > 0) {
        const next = pendingRef.current.shift()
        if (!next) continue
        webViewRef.current?.postMessage(next)
      }
      return
    }

    if (payload.type === 'apply-updates') {
      const update = new Uint8Array(payload.update)
      if (update.length === 0) return
      try {
        await applyDocUpdates(payload.key, update)
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Failed to sync local edits'
        )
      }
      return
    }

    if (payload.type === 'apply-awareness') {
      const update = new Uint8Array(payload.update)
      if (update.length === 0) return
      try {
        await applyDocAwareness(payload.key, update)
      } catch {}
      return
    }
  }

  return (
    <View style={styles.frame}>
      <WebView
        ref={webViewRef}
        style={styles.webView}
        originWhitelist={['*']}
        source={source}
        onMessage={(event) => void handleMessage(event)}
      />
      {loading ? (
        <View style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayText}>Loading editor…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.92)'
  },
  overlayText: {
    color: '#707070',
    fontSize: 15
  },
  errorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0c7c2',
    backgroundColor: '#fff6f5'
  },
  errorText: {
    color: '#a12727',
    fontSize: 14,
    lineHeight: 20
  }
})
