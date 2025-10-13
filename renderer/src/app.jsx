import { TitleBar, TitleBarTitle } from './components/title-bar'

export function App() {
  return (
    <main className='overflow-hidden h-lvh'>
      <TitleBar>
        <TitleBarTitle>Pear App</TitleBarTitle>
      </TitleBar>

      <div>App</div>
    </main>
  )
}
