import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '../../src/app/lib/paths'

describe('sign-in return destinations', () => {
  it.each(['/app', '/app/new-workspace', '/app/invite/token', '/app/w/123/tasks?assignee=me#open'])(
    'preserves app destination %s', (path) => expect(safeReturnPath(path)).toBe(path),
  )
  it.each([null, '', 'https://evil.example/app', '//evil.example/app', '/application', '/app/../../outside',
    '/app/sign-in?return=/app/sign-in', '/app/sign-in/', '/app/%73ign-in', '/app\\evil', '/app\n/evil', '/app/%']) (
    'rejects unsafe or looping destination %s', (path) => expect(safeReturnPath(path)).toBe('/app'),
  )
})
