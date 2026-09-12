import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet } from 'react-router-dom'
import './app.css'
import { SessionProvider } from './features/auth/SessionProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 15_000,
    },
  },
})

export function AppRoot() {
  return (
    <div className="brie-app">
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Outlet />
        </SessionProvider>
      </QueryClientProvider>
    </div>
  )
}
