import { Hero } from './components/Hero'
import { Features } from './components/Features'
import { Waitlist } from './components/Waitlist'

export default function App() {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col overflow-clip p-4">
      <Hero />
      <Features />
      <Waitlist />
    </main>
  )
}
