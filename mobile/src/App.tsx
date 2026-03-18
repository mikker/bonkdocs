import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Button,
  Image,
  Linking,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import {
  createNativeStackNavigator,
  type NativeStackScreenProps
} from '@react-navigation/native-stack'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { DocSurface } from './components/doc-surface'
import {
  createDocInvite,
  createDoc,
  getDoc,
  initializeDocs,
  normalizeDocUpdate,
  normalizePairStatus,
  pairInvite,
  renameDoc,
  watchDoc,
  type MobileDocRecord,
  type MobileDocView
} from './lib/doc-rpc'

type RootStackParamList = {
  Home: undefined
  Doc: {
    key: string
  }
}

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'> & {
  docs: MobileDocRecord[]
  loading: boolean
  refreshDocs: () => Promise<void>
  upsertDoc: (doc: MobileDocRecord) => void
  appError: string | null
}

type DocScreenProps = NativeStackScreenProps<RootStackParamList, 'Doc'> & {
  lookupDoc: (key: string) => MobileDocRecord | null
  upsertDoc: (doc: MobileDocRecord) => void
  updateDocEntry: (key: string, patch: Partial<MobileDocRecord>) => void
}

const WRITE_ROLE = 'doc-editor'

type EventListener = (...args: any[]) => void
type RpcStream = {
  on: (event: string, listener: EventListener) => void
  off?: (event: string, listener: EventListener) => void
  removeListener?: (event: string, listener: EventListener) => void
  destroy?: () => void
  destroyed?: boolean
}

const Stack = createNativeStackNavigator<RootStackParamList>()
const bonkArt = require('../../icon.png')

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#ffffff',
    card: '#ffffff',
    text: '#1a1a1a',
    border: '#ececec',
    primary: '#1a1a1a'
  }
}

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

function formatJoinStatus(message: string | null, progress: number | null) {
  if (!message && progress === null) return null
  if (progress === null) return message
  return `${message || 'Pairing'} (${progress}%)`
}

function friendlyTitle(doc: MobileDocRecord | MobileDocView | null) {
  const title = doc?.title?.trim()
  return title && title.length > 0 ? title : 'Untitled document'
}

function sameDocView(left: MobileDocView | null, right: MobileDocView | null) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.key === right.key &&
    left.title === right.title &&
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt &&
    left.lockedAt === right.lockedAt &&
    left.lockedBy === right.lockedBy &&
    left.canEdit === right.canEdit &&
    left.canInvite === right.canInvite &&
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles[index])
  )
}

function sameDocRecord(
  left: MobileDocRecord | null,
  right: MobileDocRecord | null
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.key === right.key &&
    left.title === right.title &&
    left.createdAt === right.createdAt &&
    left.joinedAt === right.joinedAt &&
    left.lockedAt === right.lockedAt &&
    left.lastRevision === right.lastRevision
  )
}

function parseInviteFromUrl(url: string | null | undefined) {
  if (typeof url !== 'string' || url.length === 0) return null

  try {
    const parsed = new URL(url)
    const invite = parsed.searchParams.get('invite')?.trim()
    return invite && invite.length > 0 ? invite : null
  } catch {
    return null
  }
}

export default function App() {
  const [docs, setDocs] = useState<MobileDocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [appError, setAppError] = useState<string | null>(null)

  const refreshDocs = useCallback(async () => {
    setLoading(true)
    setAppError(null)

    try {
      setDocs(await initializeDocs())
    } catch (nextError) {
      setAppError(
        nextError instanceof Error ? nextError.message : 'Failed to load worker'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshDocs()
  }, [refreshDocs])

  const upsertDoc = useCallback((doc: MobileDocRecord) => {
    setDocs((current) => [
      doc,
      ...current.filter((existing) => existing.key !== doc.key)
    ])
  }, [])

  const updateDocEntry = useCallback(
    (key: string, patch: Partial<MobileDocRecord>) => {
      setDocs((current) => {
        let changed = false

        const next = current.map((doc) => {
          if (doc.key !== key) return doc

          const updated = { ...doc }

          for (const [field, value] of Object.entries(patch)) {
            const patchKey = field as keyof MobileDocRecord
            if (updated[patchKey] === value) continue
            updated[patchKey] = value as never
            changed = true
          }

          return changed ? updated : doc
        })

        return changed ? next : current
      })
    },
    []
  )

  const lookupDoc = useCallback(
    (key: string) => docs.find((doc) => doc.key === key) ?? null,
    [docs]
  )

  return (
    <SafeAreaProvider>
      <StatusBar style='dark' />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator
          screenOptions={{
            contentStyle: { backgroundColor: '#ffffff' },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: true,
            headerStyle: {
              backgroundColor: '#ffffff'
            },
            headerTintColor: '#1a1a1a',
            headerTitleStyle: {
              fontWeight: '600'
            }
          }}
        >
          <Stack.Screen name='Home' options={{ headerShown: false }}>
            {(props) => (
              <HomeScreen
                {...props}
                appError={appError}
                docs={docs}
                loading={loading}
                refreshDocs={refreshDocs}
                upsertDoc={upsertDoc}
              />
            )}
          </Stack.Screen>
          <Stack.Screen
            name='Doc'
            options={{
              title: 'Document'
            }}
          >
            {(props) => (
              <DocScreen
                {...props}
                lookupDoc={lookupDoc}
                updateDocEntry={updateDocEntry}
                upsertDoc={upsertDoc}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

function HomeScreen({
  navigation,
  docs,
  loading,
  refreshDocs,
  upsertDoc,
  appError
}: HomeScreenProps) {
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [joinPending, setJoinPending] = useState(false)
  const [joinStatus, setJoinStatus] = useState<string | null>(null)
  const [listPanel, setListPanel] = useState<'join' | null>(null)
  const [screenError, setScreenError] = useState<string | null>(null)

  const openDoc = (doc: MobileDocRecord) => {
    upsertDoc(doc)
    navigation.navigate('Doc', { key: doc.key })
  }

  const handleCreate = async () => {
    if (createPending) return
    setCreatePending(true)
    setScreenError(null)

    try {
      const doc = await createDoc()
      openDoc(doc)
    } catch (nextError) {
      setScreenError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to create document'
      )
    } finally {
      setCreatePending(false)
    }
  }

  const startJoin = useCallback(
    async (rawInvite: string) => {
      const invite = rawInvite.trim()
      if (!invite || joinPending) return

      setJoinPending(true)
      setJoinInviteCode(invite)
      setListPanel('join')
      setJoinStatus('Starting pairing…')
      setScreenError(null)

      const stream = pairInvite(invite) as RpcStream

      await new Promise<void>((resolve, reject) => {
        let finished = false

        const cleanup = () => {
          detachStreamListener(stream, 'data', handleData)
          detachStreamListener(stream, 'error', handleError)
          detachStreamListener(stream, 'close', handleClose)
          disposeStream(stream)
        }

        const finish = (callback: () => void) => {
          if (finished) return
          finished = true
          cleanup()
          callback()
        }

        const handleData = (payload: unknown) => {
          const status = normalizePairStatus(payload)
          setJoinStatus(formatJoinStatus(status.message, status.progress))

          if (status.state === 'joined' && status.doc) {
            finish(() => {
              setJoinInviteCode('')
              setJoinStatus(null)
              setListPanel(null)
              openDoc(status.doc)
              resolve()
            })
          }

          if (status.state === 'error') {
            finish(() => {
              reject(new Error(status.message || 'Failed to join document'))
            })
          }
        }

        const handleError = (nextError: unknown) => {
          finish(() => {
            reject(
              nextError instanceof Error
                ? nextError
                : new Error('Failed to join document')
            )
          })
        }

        const handleClose = () => {
          finish(() => reject(new Error('Pairing closed before completion')))
        }

        stream.on('data', handleData)
        stream.on('error', handleError)
        stream.on('close', handleClose)
      }).catch((nextError) => {
        setScreenError(
          nextError instanceof Error ? nextError.message : 'Failed to join doc'
        )
      })

      setJoinPending(false)
      setJoinStatus(null)
    },
    [joinPending, openDoc]
  )

  const handleJoin = async () => {
    await startJoin(joinInviteCode)
  }

  useEffect(() => {
    let disposed = false

    const handleUrl = async (url: string | null | undefined) => {
      const invite = parseInviteFromUrl(url)
      if (!invite || disposed) return
      await startJoin(invite)
    }

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {})

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url)
    })

    return () => {
      disposed = true
      subscription.remove()
    }
  }, [startJoin])

  const error = screenError || appError

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.listContainer}
        contentInsetAdjustmentBehavior='automatic'
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps='handled'
      >
        <View style={styles.heroPanel}>
          <Text style={styles.eyebrow}>Bonk Docs</Text>
          <View style={styles.artFrame}>
            <Image source={bonkArt} resizeMode='contain' style={styles.art} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>Create or join a doc</Text>
            <Text style={styles.body}>
              Docs can be fun on your own but they're even better with friends
            </Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              disabled={createPending}
              onPress={() => void handleCreate()}
              style={[
                styles.button,
                styles.primaryButton,
                createPending && styles.buttonDisabled
              ]}
            >
              <Text style={styles.primaryButtonLabel}>
                {createPending ? 'Creating…' : 'Create doc'}
              </Text>
            </Pressable>
            <Pressable
              disabled={joinPending}
              onPress={() =>
                setListPanel((current) => (current === 'join' ? null : 'join'))
              }
              style={[
                styles.button,
                styles.secondaryButton,
                joinPending && styles.buttonDisabled
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>
                {joinPending ? 'Joining…' : 'Join doc'}
              </Text>
            </Pressable>
          </View>
        </View>

        {listPanel === 'join' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Join document</Text>
            <Text style={styles.cardBody}>
              Paste an invite code to join an existing doc.
            </Text>
            <TextInput
              value={joinInviteCode}
              onChangeText={setJoinInviteCode}
              placeholder='Paste invite code'
              placeholderTextColor='#8c8c8c'
              autoCapitalize='none'
              autoCorrect={false}
              style={[styles.input, styles.inputTall]}
            />
            <Pressable
              disabled={joinPending}
              onPress={() => void handleJoin()}
              style={[
                styles.button,
                styles.primaryButton,
                joinPending && styles.buttonDisabled
              ]}
            >
              <Text style={styles.primaryButtonLabel}>
                {joinPending ? 'Joining…' : 'Join doc'}
              </Text>
            </Pressable>
            {joinStatus ? <Text style={styles.muted}>{joinStatus}</Text> : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.sectionHeading}>
              <Text style={styles.cardTitle}>Your docs</Text>
              <Text style={styles.cardBody}>On this device</Text>
            </View>
            <Pressable onPress={() => void refreshDocs()} style={styles.ghost}>
              <Text style={styles.ghostLabel}>Reload</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading local documents…</Text>
            </View>
          ) : docs.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No docs yet</Text>
              <Text style={styles.empty}>
                Create one or join one with an invite.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {docs.map((doc) => (
                <Pressable
                  key={doc.key}
                  onPress={() => openDoc(doc)}
                  style={styles.listItem}
                >
                  <Text style={styles.listTitle}>{friendlyTitle(doc)}</Text>
                  <Text style={styles.listMeta}>
                    Rev {doc.lastRevision ?? 0}
                    {doc.lockedAt ? ' • Locked' : ''}
                  </Text>
                  <Text style={styles.listKey}>{doc.key.slice(0, 20)}…</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function DocScreen({
  navigation,
  route,
  lookupDoc,
  upsertDoc,
  updateDocEntry
}: DocScreenProps) {
  const key = route.params.key
  const [activeDoc, setActiveDoc] = useState<MobileDocRecord | null>(
    lookupDoc(key)
  )
  const [activeView, setActiveView] = useState<MobileDocView | null>(null)
  const [docLoading, setDocLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState(
    friendlyTitle(lookupDoc(key) || null)
  )
  const [renamePending, setRenamePending] = useState(false)
  const [sharePending, setSharePending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const watchStreamRef = useRef<RpcStream | null>(null)

  const handleShare = useCallback(async () => {
    const currentDoc = activeDoc
    const currentView = activeView

    if (!currentDoc || !currentView || sharePending) return

    if (currentView.lockedAt) {
      Alert.alert('Document locked', 'Unlock it before creating new invites.')
      return
    }

    if (!currentView.canInvite) {
      Alert.alert(
        'Sharing unavailable',
        'You do not have permission to create invites for this document.'
      )
      return
    }

    const shareInvite = async (roles: string[]) => {
      setSharePending(true)

      try {
        const result = await createDocInvite(currentDoc.key, roles)
        await Share.share({
          message: result.invite
        })
      } catch (nextError) {
        Alert.alert(
          'Share failed',
          nextError instanceof Error ? nextError.message : 'Failed to share doc'
        )
      } finally {
        setSharePending(false)
      }
    }

    if (Platform.OS !== 'ios') {
      await shareInvite([])
      return
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Share read-only', 'Share with editing'],
        cancelButtonIndex: 0
      },
      (buttonIndex) => {
        if (buttonIndex === 1) void shareInvite([])
        if (buttonIndex === 2) void shareInvite([WRITE_ROLE])
      }
    )
  }, [activeDoc, activeView, sharePending])

  useEffect(() => {
    navigation.setOptions({
      title: friendlyTitle(activeView || activeDoc),
      headerRight: () => (
        <Button
          title={sharePending ? 'Sharing…' : 'Share'}
          onPress={() => void handleShare()}
          disabled={sharePending}
        />
      )
    })
  }, [activeDoc, activeView, handleShare, navigation, sharePending])

  useEffect(() => {
    if (!activeDoc) return
    setRenameValue(friendlyTitle(activeDoc))
    setRenameError(null)
  }, [activeDoc?.key, activeDoc?.title])

  useEffect(() => {
    let closed = false
    const currentDoc = lookupDoc(key)
    if (currentDoc) {
      setActiveDoc(currentDoc)
      setActiveView((previous) =>
        previous && previous.key === currentDoc.key
          ? previous
          : {
              key: currentDoc.key,
              title: friendlyTitle(currentDoc),
              revision: currentDoc.lastRevision ?? 0,
              updatedAt: currentDoc.joinedAt ?? currentDoc.createdAt ?? null,
              lockedAt: currentDoc.lockedAt ?? null,
              lockedBy: null,
              roles: [],
              canEdit: false,
              canInvite: false
            }
      )
    }

    setDocLoading(true)
    setError(null)

    void getDoc(key)
      .then((freshDoc) => {
        if (!freshDoc || closed) return
        setActiveDoc((current) =>
          sameDocRecord(current, freshDoc) ? current : freshDoc
        )
        upsertDoc(freshDoc)
      })
      .catch((nextError) => {
        if (closed) return
        setError(
          nextError instanceof Error ? nextError.message : 'Failed to open doc'
        )
      })

    const stream = watchDoc(key) as RpcStream
    watchStreamRef.current = stream

    const handleData = (payload: unknown) => {
      if (closed) return
      const nextView = normalizeDocUpdate(
        key,
        payload,
        friendlyTitle(activeDoc || currentDoc)
      )

      setActiveView((previous) =>
        sameDocView(previous, nextView) ? previous : nextView
      )
      updateDocEntry(key, {
        title: nextView.title,
        lockedAt: nextView.lockedAt,
        lastRevision: nextView.revision
      })
      setDocLoading(false)
    }

    const handleFailure = (nextError: unknown) => {
      if (closed) return
      setDocLoading(false)
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Lost document watch connection'
      )
    }

    stream.on('data', handleData)
    stream.on('error', handleFailure)
    stream.on('close', handleFailure)

    return () => {
      closed = true
      detachStreamListener(stream, 'data', handleData)
      detachStreamListener(stream, 'error', handleFailure)
      detachStreamListener(stream, 'close', handleFailure)
      if (watchStreamRef.current === stream) {
        watchStreamRef.current = null
      }
      disposeStream(stream)
    }
  }, [key, updateDocEntry, upsertDoc])

  const handleRename = async () => {
    if (!activeDoc || renamePending) return

    const currentTitle = friendlyTitle(activeView || activeDoc)
    const nextTitle = renameValue.trim()

    if ((nextTitle || 'Untitled document') === currentTitle) {
      setRenameError(null)
      return
    }

    setRenamePending(true)
    setRenameError(null)

    try {
      const renamed = await renameDoc(activeDoc.key, nextTitle)

      setRenameValue(renamed.title)
      setActiveDoc((current) =>
        current && current.key === activeDoc.key
          ? {
              ...current,
              title: renamed.title
            }
          : current
      )
      setActiveView((current) =>
        current && current.key === activeDoc.key
          ? {
              ...current,
              title: renamed.title,
              updatedAt: renamed.updatedAt ?? current.updatedAt
            }
          : current
      )
      updateDocEntry(activeDoc.key, {
        title: renamed.title
      })
    } catch (nextError) {
      setRenameError(
        nextError instanceof Error
          ? nextError.message
          : 'Failed to rename document'
      )
    } finally {
      setRenamePending(false)
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        style={styles.docScroll}
        contentContainerStyle={styles.docContent}
        contentInsetAdjustmentBehavior='automatic'
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps='handled'
      >
        {activeView ? (
          <View style={styles.statusRow}>
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText}>
                Rev {activeView.revision}
              </Text>
            </View>
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText}>
                {activeView.canEdit ? 'Editable' : 'Read only'}
              </Text>
            </View>
            {activeView.lockedAt ? (
              <View style={styles.statusChip}>
                <Text style={styles.statusChipText}>Locked</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rename document</Text>
          <Text style={styles.cardBody}>
            You can change the title any time.
          </Text>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder='Untitled document'
            placeholderTextColor='#8c8c8c'
            style={styles.input}
          />
          <Pressable
            disabled={renamePending}
            onPress={() => void handleRename()}
            style={[
              styles.button,
              styles.secondaryButton,
              renamePending && styles.buttonDisabled
            ]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {renamePending ? 'Saving…' : 'Save title'}
            </Text>
          </Pressable>
          {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
        </View>

        {docLoading && !activeView ? (
          <View style={styles.card}>
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.muted}>Opening document…</Text>
            </View>
          </View>
        ) : null}

        {activeView ? <DocSurface doc={activeView} /> : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  listContainer: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    justifyContent: 'center'
  },
  heroPanel: {
    alignItems: 'center',
    gap: 20,
    paddingVertical: 16
  },
  heroCopy: {
    gap: 8,
    maxWidth: 360,
    alignItems: 'center'
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#7d7d7d'
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center'
  },
  body: {
    maxWidth: 320,
    fontSize: 16,
    lineHeight: 24,
    color: '#707070',
    textAlign: 'center'
  },
  artFrame: {
    width: 240,
    height: 240,
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center'
  },
  art: {
    width: '100%',
    height: '100%'
  },
  actionRow: {
    width: '100%',
    maxWidth: 320,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12
  },
  docScroll: {
    flex: 1
  },
  docContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 32
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    padding: 18,
    gap: 14
  },
  errorCard: {
    backgroundColor: '#fff6f5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0c7c2',
    padding: 14
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  sectionHeading: {
    gap: 2
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a'
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#707070'
  },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dddddd',
    color: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16
  },
  inputTall: {
    minHeight: 72,
    textAlignVertical: 'top'
  },
  button: {
    minWidth: 132,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  primaryButton: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a'
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    borderColor: '#dddddd'
  },
  buttonDisabled: {
    opacity: 0.55
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontWeight: '600'
  },
  secondaryButtonLabel: {
    color: '#1a1a1a',
    fontWeight: '600'
  },
  ghost: {
    alignSelf: 'flex-start',
    paddingHorizontal: 2,
    paddingVertical: 4
  },
  ghostLabel: {
    color: '#6d6d6d',
    fontWeight: '600'
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  muted: {
    fontSize: 15,
    lineHeight: 22,
    color: '#707070'
  },
  error: {
    color: '#a12727',
    fontSize: 15,
    lineHeight: 22
  },
  emptyState: {
    alignItems: 'flex-start',
    gap: 4
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a'
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: '#707070'
  },
  list: {
    gap: 10
  },
  listItem: {
    gap: 4,
    backgroundColor: '#fafafa',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    padding: 14
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a'
  },
  listMeta: {
    fontSize: 14,
    color: '#707070'
  },
  listKey: {
    fontSize: 13,
    color: '#8a8a8a'
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    backgroundColor: '#f7f7f7',
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  statusChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#555555'
  }
})
