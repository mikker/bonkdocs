import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Button,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import {
  createNavigationContainerRef,
  DefaultTheme,
  DrawerActions,
  NavigationContainer,
  NavigatorScreenParams,
  StackActions
} from '@react-navigation/native'
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItem,
  type DrawerContentComponentProps
} from '@react-navigation/drawer'
import {
  createNativeStackNavigator,
  type NativeStackScreenProps
} from '@react-navigation/native-stack'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { DocSurface } from './components/doc-surface'
import {
  abandonDoc,
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

type RootDrawerParamList = {
  Main: NavigatorScreenParams<RootStackParamList> | undefined
}

type HomeScreenProps = {
  appError: string | null
  hasDocs: boolean
}

type DocScreenProps = NativeStackScreenProps<RootStackParamList, 'Doc'> & {
  lookupDoc: (key: string) => MobileDocRecord | null
  upsertDoc: (doc: MobileDocRecord) => void
  updateDocEntry: (key: string, patch: Partial<MobileDocRecord>) => void
  toggleSidebar: () => void
  createPending: boolean
  createNewDoc: () => Promise<void>
  refreshDocs: () => Promise<void>
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

const Drawer = createDrawerNavigator<RootDrawerParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()
const navigationRef = createNavigationContainerRef<RootDrawerParamList>()
const IOS_TINT = '#007aff'
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

function formatDocTimestamp(value: number | null | undefined) {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    }).format(new Date(value))
  } catch {
    return 'Unknown'
  }
}

function AppDrawerContent({
  docs,
  loading,
  createPending,
  joinInviteCode,
  joinPending,
  joinStatus,
  sidebarPanel,
  sidebarError,
  setJoinInviteCode,
  toggleJoinPanel,
  createNewDoc,
  openDoc,
  submitJoin
}: DrawerContentComponentProps & {
  docs: MobileDocRecord[]
  loading: boolean
  createPending: boolean
  joinInviteCode: string
  joinPending: boolean
  joinStatus: string | null
  sidebarPanel: 'join' | null
  sidebarError: string | null
  setJoinInviteCode: (value: string) => void
  toggleJoinPanel: () => void
  createNewDoc: () => Promise<void>
  openDoc: (doc: MobileDocRecord) => void
  submitJoin: () => Promise<void>
}) {
  return (
    <DrawerContentScrollView contentContainerStyle={styles.drawerContent}>
      <View style={styles.drawerMain}>
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
          <View style={styles.drawerList}>
            {docs.map((doc) => (
              <DrawerItem
                key={doc.key}
                label={() => (
                  <View style={styles.listLabel}>
                    <Text style={styles.listTitle}>{friendlyTitle(doc)}</Text>
                    {doc.lockedAt ? (
                      <Text style={styles.listMeta}>Locked</Text>
                    ) : null}
                  </View>
                )}
                onPress={() => openDoc(doc)}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.drawerFooter}>
        {sidebarPanel === 'join' ? (
          <View style={styles.card}>
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
              accessibilityRole='button'
              onPress={() => void submitJoin()}
              disabled={joinPending}
              style={({ pressed }) => [
                styles.drawerActionButton,
                pressed && !joinPending ? styles.iconButtonPressed : null
              ]}
            >
              <Text style={styles.drawerActionIcon}>↘</Text>
              <Text style={styles.drawerActionLabel}>
                {joinPending ? 'Joining…' : 'Join doc'}
              </Text>
            </Pressable>
            {joinStatus ? <Text style={styles.muted}>{joinStatus}</Text> : null}
          </View>
        ) : null}

        <DrawerItem
          label='Create doc'
          icon={() => <Text style={styles.drawerItemIcon}>+</Text>}
          onPress={() => {
            if (createPending || joinPending) return
            void createNewDoc()
          }}
        />
        <DrawerItem
          label={sidebarPanel === 'join' ? 'Hide join' : 'Join doc'}
          icon={() => <Text style={styles.drawerItemIcon}>↘</Text>}
          onPress={() => {
            if (joinPending) return
            toggleJoinPanel()
          }}
        />
      </View>

      {sidebarError ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{sidebarError}</Text>
        </View>
      ) : null}
    </DrawerContentScrollView>
  )
}

export default function App() {
  const [docs, setDocs] = useState<MobileDocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [appError, setAppError] = useState<string | null>(null)
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [createPending, setCreatePending] = useState(false)
  const [joinPending, setJoinPending] = useState(false)
  const [joinStatus, setJoinStatus] = useState<string | null>(null)
  const [sidebarPanel, setSidebarPanel] = useState<'join' | null>(null)
  const [sidebarError, setSidebarError] = useState<string | null>(null)

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

  const closeSidebar = useCallback(() => {
    if (!navigationRef.isReady()) return
    navigationRef.dispatch(DrawerActions.closeDrawer())
  }, [])

  const toggleSidebar = useCallback(() => {
    if (!navigationRef.isReady()) return
    navigationRef.dispatch(DrawerActions.toggleDrawer())
  }, [])

  const openDoc = useCallback(
    (doc: MobileDocRecord) => {
      upsertDoc(doc)
      setSidebarPanel(null)

      if (!navigationRef.isReady()) return

      const currentRoute = navigationRef.getCurrentRoute()
      if (currentRoute?.name === 'Doc') {
        if (currentRoute.params?.key === doc.key) {
          closeSidebar()
          return
        }
        navigationRef.dispatch(StackActions.replace('Doc', { key: doc.key }))
      } else {
        navigationRef.navigate('Main', {
          screen: 'Doc',
          params: { key: doc.key }
        })
      }

      closeSidebar()
    },
    [closeSidebar, upsertDoc]
  )

  const handleCreate = useCallback(async () => {
    if (createPending) return

    setCreatePending(true)
    setSidebarError(null)

    try {
      const doc = await createDoc()
      openDoc(doc)
      await refreshDocs()
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : 'Failed to create document'
      setSidebarError(message)
      Alert.alert('Create failed', message)
    } finally {
      setCreatePending(false)
    }
  }, [createPending, openDoc, refreshDocs])

  const startJoin = useCallback(
    async (rawInvite: string) => {
      const invite = rawInvite.trim()
      if (!invite || joinPending) return

      if (navigationRef.isReady()) {
        navigationRef.dispatch(DrawerActions.openDrawer())
      }
      setJoinPending(true)
      setJoinInviteCode(invite)
      setSidebarPanel('join')
      setJoinStatus('Starting pairing…')
      setSidebarError(null)

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
            const joinedDoc = status.doc
            finish(() => {
              setJoinInviteCode('')
              setJoinStatus(null)
              setSidebarPanel(null)
              openDoc(joinedDoc)
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
        setSidebarError(
          nextError instanceof Error ? nextError.message : 'Failed to join doc'
        )
      })

      setJoinPending(false)
      setJoinStatus(null)
    },
    [joinPending, openDoc]
  )

  const handleJoin = useCallback(async () => {
    await startJoin(joinInviteCode)
  }, [joinInviteCode, startJoin])

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

  return (
    <SafeAreaProvider>
      <StatusBar style='dark' />
      <View style={styles.appShell}>
        <NavigationContainer theme={navigationTheme} ref={navigationRef}>
          <Drawer.Navigator
            screenListeners={{
              transitionEnd: (event) => {
                if (!event.data.closing) {
                  void refreshDocs()
                }
              }
            }}
            screenOptions={{
              headerShown: false,
              drawerType: 'front'
            }}
            drawerContent={(props) => (
              <AppDrawerContent
                {...props}
                createNewDoc={handleCreate}
                createPending={createPending}
                docs={docs}
                joinInviteCode={joinInviteCode}
                joinPending={joinPending}
                joinStatus={joinStatus}
                loading={loading}
                openDoc={openDoc}
                setJoinInviteCode={setJoinInviteCode}
                sidebarError={sidebarError || appError}
                sidebarPanel={sidebarPanel}
                submitJoin={handleJoin}
                toggleJoinPanel={() =>
                  setSidebarPanel((current) =>
                    current === 'join' ? null : 'join'
                  )
                }
              />
            )}
          >
            <Drawer.Screen name='Main'>
              {() => (
                <Stack.Navigator
                  screenOptions={{
                    contentStyle: { backgroundColor: '#ffffff' },
                    headerBackButtonDisplayMode: 'minimal',
                    headerBackVisible: false,
                    headerShadowVisible: true,
                    headerStyle: {
                      backgroundColor: '#ffffff'
                    },
                    headerTintColor: IOS_TINT,
                    headerTitleStyle: {
                      fontWeight: '600',
                      color: '#1a1a1a'
                    }
                  }}
                >
                  <Stack.Screen
                    name='Home'
                    options={{
                      title: 'Bonk Docs',
                      headerLeft: () => (
                        <HeaderIconButton
                          icon='☰'
                          label='Menu'
                          onPress={() => toggleSidebar()}
                        />
                      ),
                      headerRight: () => (
                        <HeaderIconButton
                          icon={createPending ? '…' : '+'}
                          label='New document'
                          onPress={() => void handleCreate()}
                          disabled={createPending}
                        />
                      )
                    }}
                  >
                    {() => (
                      <HomeScreen
                        appError={appError}
                        hasDocs={docs.length > 0}
                      />
                    )}
                  </Stack.Screen>
                  <Stack.Screen name='Doc' options={{ title: 'Document' }}>
                    {(props) => (
                      <DocScreen
                        {...props}
                        createNewDoc={handleCreate}
                        createPending={createPending}
                        lookupDoc={lookupDoc}
                        refreshDocs={refreshDocs}
                        toggleSidebar={toggleSidebar}
                        updateDocEntry={updateDocEntry}
                        upsertDoc={upsertDoc}
                      />
                    )}
                  </Stack.Screen>
                </Stack.Navigator>
              )}
            </Drawer.Screen>
          </Drawer.Navigator>
        </NavigationContainer>
      </View>
    </SafeAreaProvider>
  )
}

function HomeScreen({ appError, hasDocs }: HomeScreenProps) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.homeState}>
        <View style={styles.artFrame}>
          <Image source={bonkArt} resizeMode='contain' style={styles.art} />
        </View>
        <View style={styles.homeCopy}>
          <Text style={styles.title}>
            {hasDocs ? 'Pick a doc from the menu' : 'Start a new doc'}
          </Text>
          <Text style={styles.body}>
            {hasDocs
              ? 'Use the menu to switch documents.'
              : 'Use + to create a doc or open the menu to join one.'}
          </Text>
        </View>
      </View>

      {appError ? (
        <View style={styles.homeError}>
          <Text style={styles.error}>{appError}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function DocScreen({
  navigation,
  route,
  lookupDoc,
  upsertDoc,
  updateDocEntry,
  toggleSidebar,
  createPending,
  createNewDoc,
  refreshDocs
}: DocScreenProps) {
  const key = route.params.key
  const [activeDoc, setActiveDoc] = useState<MobileDocRecord | null>(
    lookupDoc(key)
  )
  const [activeView, setActiveView] = useState<MobileDocView | null>(null)
  const [docLoading, setDocLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState(
    friendlyTitle(lookupDoc(key) || null)
  )
  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renamePending, setRenamePending] = useState(false)
  const [sharePending, setSharePending] = useState(false)
  const [abandonPending, setAbandonPending] = useState(false)

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

  const handleAbandon = useCallback(async () => {
    if (!activeDoc || abandonPending) return

    setAbandonPending(true)

    try {
      await abandonDoc(activeDoc.key)
      await refreshDocs()
      navigation.dispatch(StackActions.replace('Home'))
    } catch (nextError) {
      Alert.alert(
        'Abandon failed',
        nextError instanceof Error
          ? nextError.message
          : 'Failed to abandon document'
      )
    } finally {
      setAbandonPending(false)
    }
  }, [abandonPending, activeDoc, navigation, refreshDocs])

  useEffect(() => {
    if (!activeDoc) return
    setRenameDraft(friendlyTitle(activeDoc))
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

  const handleRename = useCallback(
    async (value: string) => {
      if (!activeDoc || renamePending) return

      if (activeView?.lockedAt) {
        Alert.alert(
          'Rename unavailable',
          'Unlock the document before renaming it.'
        )
        return
      }

      if (activeView && !activeView.canEdit) {
        Alert.alert(
          'Rename unavailable',
          'You can only rename documents you can edit.'
        )
        return
      }

      const currentTitle = friendlyTitle(activeView || activeDoc)
      const nextTitle = value.trim()

      if ((nextTitle || 'Untitled document') === currentTitle) {
        setRenameModalVisible(false)
        return
      }

      setRenamePending(true)

      try {
        const renamed = await renameDoc(activeDoc.key, nextTitle)

        setRenameDraft(renamed.title)
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
        await refreshDocs()
      } catch (nextError) {
        Alert.alert(
          'Rename failed',
          nextError instanceof Error
            ? nextError.message
            : 'Failed to rename document'
        )
      } finally {
        setRenamePending(false)
        setRenameModalVisible(false)
      }
    },
    [activeDoc, activeView, refreshDocs, renamePending, updateDocEntry]
  )

  const showStats = useCallback(() => {
    Alert.alert(
      'Document stats',
      [
        `Title: ${friendlyTitle(activeView || activeDoc)}`,
        `Revision: ${activeView?.revision ?? activeDoc?.lastRevision ?? 0}`,
        `Access: ${activeView?.canEdit ? 'Editable' : 'Read only'}`,
        `Locked: ${activeView?.lockedAt ? 'Yes' : 'No'}`,
        `Updated: ${formatDocTimestamp(activeView?.updatedAt)}`,
        `Key: ${activeDoc?.key ?? key}`
      ].join('\n')
    )
  }, [activeDoc, activeView, key])

  const openRenamePrompt = useCallback(() => {
    if (activeView?.lockedAt) {
      Alert.alert(
        'Rename unavailable',
        'Unlock the document before renaming it.'
      )
      return
    }

    if (activeView && !activeView.canEdit) {
      Alert.alert(
        'Rename unavailable',
        'You can only rename documents you can edit.'
      )
      return
    }

    const currentTitle = friendlyTitle(activeView || activeDoc)
    setRenameDraft(currentTitle)

    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Rename document',
        'Change the title.',
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Save',
            onPress: (value?: string) => {
              void handleRename(value ?? currentTitle)
            }
          }
        ],
        'plain-text',
        currentTitle
      )
      return
    }

    setRenameModalVisible(true)
  }, [activeDoc, activeView, handleRename])

  const handleMoreMenu = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Share', 'Rename', 'Stats', 'Abandon doc'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 4
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void handleShare()
          if (buttonIndex === 2) openRenamePrompt()
          if (buttonIndex === 3) showStats()
          if (buttonIndex === 4) {
            Alert.alert(
              'Abandon document',
              'Remove it from this device? It may still exist elsewhere.',
              [
                {
                  text: 'Cancel',
                  style: 'cancel'
                },
                {
                  text: abandonPending ? 'Abandoning…' : 'Abandon doc',
                  style: 'destructive',
                  onPress: () => void handleAbandon()
                }
              ]
            )
          }
        }
      )
      return
    }

    Alert.alert(friendlyTitle(activeView || activeDoc), undefined, [
      {
        text: 'Share',
        onPress: () => void handleShare()
      },
      {
        text: 'Rename',
        onPress: openRenamePrompt
      },
      {
        text: 'Stats',
        onPress: showStats
      },
      {
        text: abandonPending ? 'Abandoning…' : 'Abandon doc',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Abandon document',
            'Remove it from this device? It may still exist elsewhere.',
            [
              {
                text: 'Cancel',
                style: 'cancel'
              },
              {
                text: abandonPending ? 'Abandoning…' : 'Abandon doc',
                style: 'destructive',
                onPress: () => void handleAbandon()
              }
            ]
          )
      }
    ])
  }, [
    abandonPending,
    activeDoc,
    activeView,
    handleAbandon,
    handleShare,
    openRenamePrompt,
    showStats
  ])

  useEffect(() => {
    navigation.setOptions({
      title: friendlyTitle(activeView || activeDoc),
      headerLeft: () => (
        <HeaderIconButton
          icon='☰'
          label='Menu'
          onPress={() => toggleSidebar()}
        />
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          <HeaderIconButton
            icon='…'
            label='More actions'
            onPress={() => void handleMoreMenu()}
            disabled={abandonPending || sharePending || renamePending}
          />
          <HeaderIconButton
            icon={createPending ? '…' : '+'}
            label='New document'
            onPress={() => void createNewDoc()}
            disabled={createPending}
          />
        </View>
      )
    })
  }, [
    activeDoc,
    activeView,
    createNewDoc,
    createPending,
    handleMoreMenu,
    navigation,
    renamePending,
    abandonPending,
    sharePending,
    toggleSidebar
  ])

  return (
    <SafeAreaView edges={['bottom']} style={styles.docSafeArea}>
      {activeView ? <DocSurface doc={activeView} /> : null}

      {docLoading && !activeView ? (
        <View style={styles.docState}>
          <ActivityIndicator />
          <Text style={styles.muted}>Opening document…</Text>
        </View>
      ) : null}

      {error && !activeView ? (
        <View style={styles.docState}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {error && activeView ? (
        <View style={styles.docErrorBanner}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      <Modal
        visible={renameModalVisible}
        transparent
        animationType='fade'
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setRenameModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.cardTitle}>Rename document</Text>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder='Untitled document'
              placeholderTextColor='#8c8c8c'
              style={styles.input}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button
                title='Cancel'
                onPress={() => setRenameModalVisible(false)}
              />
              <Button
                title={renamePending ? 'Saving…' : 'Save'}
                onPress={() => void handleRename(renameDraft)}
                disabled={renamePending}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

function HeaderIconButton({
  icon,
  label,
  onPress,
  disabled = false
}: {
  icon: string
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && !disabled ? styles.iconButtonPressed : null,
        disabled ? styles.iconButtonDisabled : null
      ]}
    >
      <Text style={styles.iconButtonText}>{icon}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  homeState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 20
  },
  homeCopy: {
    gap: 8,
    maxWidth: 360,
    alignItems: 'center'
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
  title: {
    fontSize: 28,
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
  homeError: {
    paddingHorizontal: 24,
    paddingBottom: 24
  },
  drawerContent: {
    flexGrow: 1,
    paddingVertical: 12,
    justifyContent: 'space-between',
    gap: 12
  },
  drawerList: {
    gap: 2
  },
  drawerMain: {
    gap: 8
  },
  drawerFooter: {
    gap: 8,
    paddingTop: 8
  },
  docSafeArea: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  docState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10
  },
  docErrorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: '#fff6f5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0c7c2',
    padding: 14
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    gap: 14
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12
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
    marginHorizontal: 16,
    backgroundColor: '#fff6f5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0c7c2',
    padding: 14
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
  iconButton: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonPressed: {
    opacity: 0.45
  },
  iconButtonDisabled: {
    opacity: 0.35
  },
  iconButtonText: {
    fontSize: 28,
    lineHeight: 28,
    color: IOS_TINT,
    fontWeight: '400'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14
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
    gap: 4,
    paddingHorizontal: 16
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
  listLabel: {
    gap: 4
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
  drawerItemIcon: {
    width: 20,
    textAlign: 'center',
    fontSize: 19,
    lineHeight: 22,
    color: '#1a1a1a'
  },
  drawerActionButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14
  },
  drawerActionIcon: {
    width: 20,
    textAlign: 'center',
    fontSize: 19,
    lineHeight: 22,
    color: IOS_TINT
  },
  drawerActionLabel: {
    fontSize: 17,
    lineHeight: 22,
    color: IOS_TINT
  }
})
