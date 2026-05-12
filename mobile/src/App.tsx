import { StatusBar } from 'expo-status-bar'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createDrawerNavigator } from '@react-navigation/drawer'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Pressable, StyleSheet, Text, View } from 'react-native'

const Drawer = createDrawerNavigator()

const theme = {
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

function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Bonk Docs</Text>
        <Text style={styles.title}>Native shell</Text>
        <Text style={styles.body}>
          The React Native host, navigation, and Pear worker bootstrap are kept
          in place. Document sync UI will be rebuilt on top of pear-sdk spaces.
        </Text>
        <Pressable style={styles.button} disabled>
          <Text style={styles.buttonText}>Docs coming back next</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <Drawer.Navigator
          screenOptions={{
            headerTitle: 'Bonk Docs',
            drawerActiveTintColor: '#1a1a1a'
          }}
        >
          <Drawer.Screen name='Home' component={HomeScreen} />
        </Drawer.Navigator>
      </NavigationContainer>
      <StatusBar style='dark' />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    gap: 14
  },
  eyebrow: {
    color: '#737373',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  title: {
    color: '#171717',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.6
  },
  body: {
    color: '#525252',
    fontSize: 16,
    lineHeight: 24
  },
  button: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#171717',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    opacity: 0.45
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600'
  }
})
