import { AppShell } from './AppShell'
import { AppUnavailablePage } from './NotFoundPage'
import { SignInPage } from './features/auth/SignInPage'
import { EventAttendancePage } from './features/attendance/EventAttendancePage'
import { HistoryPage } from './features/attendance/HistoryPage'
import { ImportPage } from './features/attendance/ImportPage'
import { PersonPage } from './features/attendance/PersonPage'
import { ReceiptPage } from './features/attendance/ReceiptPage'
import { EventFormPage } from './features/events/EventFormPage'
import { EventLayout } from './features/events/EventLayout'
import { EventListPage } from './features/events/EventListPage'
import { EventOverviewPage } from './features/events/EventOverviewPage'
import { RunOfShowPage } from './features/schedule/RunOfShowPage'
import { EventTasksPage, WorkspaceTasksPage } from './features/tasks/TasksPage'
import { AppHome } from './features/workspaces/AppHome'
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

export const appChildren = [
  { path: '/app', Component: AppHome },
  { path: '/app/sign-in', Component: SignInPage },
  { path: '/app/new-workspace', Component: NewWorkspacePage },
  { path: '/app/invite/:token', Component: InvitePage },
  {
    path: '/app/w/:workspaceId',
    Component: AppShell,
    children: [
      { path: 'events', Component: EventListPage },
      { path: 'events/new', Component: NewEventPage },
      { path: 'events/:eventId/edit', Component: EditEventPage },
      { path: 'events/:eventId/duplicate', Component: DuplicateEventPage },
      {
        path: 'events/:eventId',
        Component: EventLayout,
        children: [
          { index: true, Component: EventOverviewPage },
          { path: 'tasks', Component: EventTasksPage },
          { path: 'run-of-show', Component: RunOfShowPage },
          { path: 'attendance', Component: EventAttendancePage },
          { path: 'attendance/import', Component: ImportPage },
          { path: 'attendance/imports/:batchId', Component: ReceiptPage },
        ],
      },
      { path: 'tasks', Component: WorkspaceTasksPage },
      { path: 'attendance', Component: HistoryPage },
      { path: 'attendance/:personId', Component: PersonPage },
      { path: 'settings', Component: SettingsPage },
      { path: '*', Component: AppUnavailablePage },
    ],
  },
  { path: '/app/*', Component: AppUnavailablePage },
]
