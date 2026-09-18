import { Navigate, useLocation, useParams } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppUnavailablePage } from './NotFoundPage'
import { SignInPage } from './features/auth/SignInPage'
import { EventAttendancePage } from './features/attendance/EventAttendancePage'
import { HistoryPage } from './features/attendance/HistoryPage'
import { ImportPage } from './features/attendance/ImportPage'
import { PersonPage } from './features/attendance/PersonPage'
import { ReceiptPage } from './features/attendance/ReceiptPage'
import { EventFormPage } from './features/events/EventFormPage'
import { EventLayout, EventSectionRedirect } from './features/events/EventLayout'
import { EventListPage } from './features/events/EventListPage'
import { EventPage } from './features/events/EventPage'
import { AppHome } from './features/workspaces/AppHome'
import { HomePage } from './features/workspaces/HomePage'
import { InvitePage } from './features/workspaces/InvitePage'
import { NewWorkspacePage } from './features/workspaces/NewWorkspacePage'
import { SettingsPage } from './features/workspaces/SettingsPage'

function NewEventPage() {
  return <EventFormPage mode="new" />
}

function EditEventPage() {
  return <EventFormPage mode="edit" />
}

function DuplicateEventPage() {
  return <EventFormPage mode="duplicate" />
}

function BeforeRedirect() {
  return <EventSectionRedirect section="before" />
}

function DayOfRedirect() {
  return <EventSectionRedirect section="day-of" />
}

/** Old workspace bookmarks: /tasks is now Home, /attendance is now People. Keeps the query string. */
function WorkspaceRedirect({ to }: { to: 'home' | 'people' }) {
  const { workspaceId = '', personId } = useParams()
  const { search } = useLocation()
  const path = `/app/w/${workspaceId}/${to}${personId ? `/${personId}` : ''}`
  return <Navigate to={to === 'home' ? path : `${path}${search}`} replace />
}

function TasksRedirect() {
  return <WorkspaceRedirect to="home" />
}

function AttendanceRedirect() {
  return <WorkspaceRedirect to="people" />
}

export const appChildren = [
  { path: '/app', Component: AppHome },
  { path: '/app/sign-in', Component: SignInPage },
  { path: '/app/new-workspace', Component: NewWorkspacePage },
  { path: '/app/invite/:token', Component: InvitePage },
  {
    path: '/app/w/:workspaceId',
    Component: AppShell,
    children: [
      { path: 'home', Component: HomePage },
      { path: 'events', Component: EventListPage },
      { path: 'events/new', Component: NewEventPage },
      { path: 'events/:eventId/edit', Component: EditEventPage },
      { path: 'events/:eventId/duplicate', Component: DuplicateEventPage },
      {
        path: 'events/:eventId',
        Component: EventLayout,
        children: [
          { index: true, Component: EventPage },
          { path: 'tasks', Component: BeforeRedirect },
          { path: 'run-of-show', Component: DayOfRedirect },
          { path: 'attendance', Component: EventAttendancePage },
          { path: 'attendance/import', Component: ImportPage },
          { path: 'attendance/imports/:batchId', Component: ReceiptPage },
        ],
      },
      { path: 'tasks', Component: TasksRedirect },
      { path: 'people', Component: HistoryPage },
      { path: 'people/:personId', Component: PersonPage },
      { path: 'attendance', Component: AttendanceRedirect },
      { path: 'attendance/:personId', Component: AttendanceRedirect },
      { path: 'settings', Component: SettingsPage },
      { path: '*', Component: AppUnavailablePage },
    ],
  },
  { path: '/app/*', Component: AppUnavailablePage },
]
