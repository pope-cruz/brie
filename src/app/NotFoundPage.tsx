import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="brie-app">
      <div className="app-page">
        <h1 className="app-h1">Page not found</h1>
        <p className="app-lede">That address isn’t a Brie page.</p>
        <Link className="app-btn app-btn-primary" to="/app">
          Go to events
        </Link>
      </div>
    </div>
  )
}

export function AppUnavailablePage() {
  return (
    <div className="app-page">
      <h1 className="app-h1">This page isn’t available</h1>
      <p className="app-lede">Go back to your events, or sign in again if your session ended.</p>
      <Link className="app-btn app-btn-primary" to="/app">
        Go to events
      </Link>
    </div>
  )
}
