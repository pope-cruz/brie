import { createBrowserRouter } from 'react-router-dom'
import { AppRoot } from './AppRoot'
import { appChildren } from './appRoutes'
import { NotFoundPage } from './NotFoundPage'

export const router = createBrowserRouter([
  {
    path: '/',
    lazy: () => import('../App').then((module) => ({ Component: module.default })),
  },
  {
    Component: AppRoot,
    HydrateFallback: AppRoot,
    children: appChildren,
  },
  {
    path: '*',
    Component: NotFoundPage,
  },
])
