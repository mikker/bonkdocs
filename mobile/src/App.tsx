import { useEffect, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { getRpc } from './lib/rpc'

type DocRecord = {
  key: string
  title?: string | null
}

export default function App() {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const rpc = getRpc()
      const response = await rpc.initialize({})
      const nextDocs = Array.isArray(response?.docs) ? response.docs : []
      setDocs(nextDocs)
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to load worker'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style='dark' />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Bonk Docs Mobile</Text>
          <Text style={styles.title}>iOS host scaffold</Text>
          <Text style={styles.body}>
            The shared worker is running in a Bare worklet. The rich-text editor
            will be mounted through a WebView-backed surface in the next pass.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Worker status</Text>
            <Pressable onPress={() => void load()} style={styles.button}>
              <Text style={styles.buttonLabel}>Reload</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.muted}>Connecting to shared backend…</Text>
            </View>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <>
              <Text style={styles.muted}>
                Connected. Known docs on this device: {docs.length}
              </Text>
              <View style={styles.list}>
                {docs.length === 0 ? (
                  <Text style={styles.empty}>
                    No local docs yet. Create or join flows will be added next.
                  </Text>
                ) : (
                  docs.map((doc) => (
                    <View key={doc.key} style={styles.listItem}>
                      <Text style={styles.listTitle}>
                        {doc.title?.trim() || 'Untitled document'}
                      </Text>
                      <Text style={styles.listKey}>
                        {doc.key.slice(0, 16)}…
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f6f0e5'
  },
  container: {
    padding: 24,
    gap: 16
  },
  hero: {
    gap: 10
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#8a5a2b'
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1f1a17'
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#4b4139'
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dbc7a6',
    padding: 18,
    gap: 14
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f1a17'
  },
  button: {
    backgroundColor: '#1f1a17',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  buttonLabel: {
    color: '#fffaf2',
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
    color: '#5b5249'
  },
  error: {
    color: '#a12727',
    fontSize: 15,
    lineHeight: 22
  },
  list: {
    gap: 10
  },
  empty: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5b5249'
  },
  listItem: {
    gap: 4,
    backgroundColor: '#f6ead5',
    borderRadius: 14,
    padding: 14
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f1a17'
  },
  listKey: {
    fontSize: 13,
    color: '#6d6359'
  }
})
