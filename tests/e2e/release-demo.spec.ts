import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { signIn, signOut, uniqueEmail } from './helpers/auth'
import { mailpitReachable } from './helpers/mailpit'

// Automates the multi-account release demonstration from docs/TESTING.md and
// tests/e2e/release-demo.md against the local Supabase stack. Every account,
// workspace, and attendee here is fictional and created fresh per run, so the
// suite never touches saved local work. Requires `supabase start` and the Vite
// dev server (playwright.config.ts starts the latter).

const FIXTURES = resolve('tests/fixtures')
// Public browser values only, read the same way Vite does, for the direct-RPC denial probe.
const ENV = Object.fromEntries(
  ['.env.local', '.env'].filter((file) => existsSync(file)).flatMap((file) =>
    readFileSync(file, 'utf8').split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()] as const)),
)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ENV.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ENV.VITE_SUPABASE_ANON_KEY || ''
const STAMP = Date.now().toString(36)
const OWNER = uniqueEmail('owner')
const WRONG_CODE_EMAIL = uniqueEmail('wrong-code')
const ORGANIZER = uniqueEmail('organizer')
const MEMBER = uniqueEmail('member')
const OUTSIDER = uniqueEmail('outsider')

const state = {
  workspaceId: '',
  eventId: '',
  copyEventId: '',
  organizerLink: '',
  memberLink: '',
}

let owner: BrowserContext
let organizer: BrowserContext
let member: BrowserContext
let ownerPage: Page
let organizerPage: Page
let memberPage: Page

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
  })
}

function eventUrl(path = '') {
  return `/app/w/${state.workspaceId}/events/${state.eventId}${path}`
}

async function openMobileMenu(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click()
  return page.getByRole('dialog')
}

async function fillRange(page: Page, start: { date: string; time: string }, endTime: string) {
  await page.getByLabel('Start date', { exact: true }).fill(start.date)
  await page.getByLabel('Start time', { exact: true }).fill(start.time)
  await page.getByLabel('End time', { exact: true }).fill(endTime)
}

async function addScheduleItem(page: Page, input: { title: string; start: string; end: string; notes: string; assigned?: boolean }) {
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
  await page.getByLabel('Activity for new item').fill(input.title)
  await page.getByLabel('Start for new item').fill(input.start)
  await page.getByLabel('Length for new item').fill(`${minutes(input.end) - minutes(input.start)}m`)
  if (input.assigned) await page.getByLabel('Owner for new item').selectOption({ label: 'Owner QA' })
  await page.getByLabel('Notes for new item').fill(input.notes)
  await page.getByLabel('Activity for new item').press('Enter')
  await expect(page.getByRole('button', { name: `Edit ${input.title}`, exact: true })).toBeVisible()
}

/** Downloads the run-of-show PDF for a choice and checks that making it sent nothing to the backend. */
async function downloadPdf(page: Page, choice: { label: string } | { value: string }) {
  await page.getByRole('button', { name: 'Download PDF' }).click()
  await page.getByLabel('Download for').selectOption(choice)
  const backend: string[] = []
  const record = (request: { url: () => string }) => { if (request.url().startsWith(SUPABASE_URL)) backend.push(request.url()) }
  page.on('request', record)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()])
  page.off('request', record)
  expect(backend).toEqual([])
  const file = await download.path()
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  const pages = (bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
  mkdirSync('test-results/release-evidence', { recursive: true })
  copyFileSync(file, `test-results/release-evidence/${download.suggestedFilename()}`)
  return { name: download.suggestedFilename(), pages }
}

async function importCsv(page: Page, eventId: string, file: string) {
  await page.goto(`/app/w/${state.workspaceId}/events/${eventId}/attendance/import`)
  await page.locator('input[type="file"]').setInputFiles(resolve(FIXTURES, file))
  await expect(page.getByRole('heading', { name: 'Map columns' })).toBeVisible()
  await expect(page.getByLabel('Email')).not.toHaveValue('')
  await page.getByRole('button', { name: 'Review' }).click()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  const summary = (await page.getByText(/new · .* already recorded/).textContent()) ?? ''
  await page.getByRole('button', { name: /^Record attendance for \d+ people$/ }).click()
  await expect(page).toHaveURL(/\/attendance\/imports\//)
  return summary
}

async function setupContexts(browser: Browser) {
  owner = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  organizer = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  member = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
  ownerPage = await owner.newPage()
  organizerPage = await organizer.newPage()
  memberPage = await member.newPage()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  test.skip(!(await mailpitReachable()), 'Local Supabase stack (Mailpit on 54324) is not running; see docs/SETUP.md.')
  await setupContexts(browser)
})

test.afterAll(async () => {
  await Promise.all([owner?.close(), organizer?.close(), member?.close()])
})

test('1. owner signs in, rejects a wrong code, and creates exactly one workspace', async () => {
  await ownerPage.goto('/app/sign-in')
  await ownerPage.getByLabel('Email').fill(WRONG_CODE_EMAIL)
  await ownerPage.getByRole('button', { name: 'Send code' }).click()
  await expect(ownerPage.getByRole('heading', { name: 'Enter your code' })).toBeVisible()
  await ownerPage.getByLabel('Code').fill('000000')
  await ownerPage.getByRole('button', { name: 'Verify' }).click()
  await expect(ownerPage.getByRole('alert')).toContainText(/invalid or has expired|Couldn’t verify/)
  await expect(ownerPage.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled()
  await ownerPage.getByRole('button', { name: 'Change email' }).click()
  await expect(ownerPage.getByLabel('Email')).toHaveValue(WRONG_CODE_EMAIL)
  await expect(ownerPage.getByRole('alert')).toHaveCount(0)

  // The helper waits out the one-minute resend limit for this address.
  await signIn(ownerPage, OWNER)
  await expect(ownerPage).toHaveURL(/\/app\/new-workspace/)
  await ownerPage.getByLabel('Workspace name').fill(`Campus Events QA ${STAMP}`)
  await ownerPage.getByLabel('Your display name').fill('Owner QA')
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click()
  await expect(ownerPage).toHaveURL(/\/app\/w\/[0-9a-f-]{36}\/home/)
  state.workspaceId = ownerPage.url().match(/\/app\/w\/([0-9a-f-]{36})/)![1]
  await expect(ownerPage.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(ownerPage.getByText('Nothing assigned to you yet')).toBeVisible()
  await expect(ownerPage.getByText('No upcoming events')).toBeVisible()

  await ownerPage.reload()
  await expect(ownerPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home`))
  await expect(ownerPage.locator('#workspace-switcher')).toHaveValue(state.workspaceId)
  const options = await ownerPage.locator('#workspace-switcher option').allTextContents()
  expect(options.filter((name) => name.startsWith('Campus Events QA'))).toHaveLength(1)
})

test('2. owner plans an event with a task and a run-of-show segment', async () => {
  // Quick create from the event list: a popover asking title and times.
  await ownerPage.goto(`/app/w/${state.workspaceId}/events`)
  await ownerPage.getByRole('button', { name: 'New event' }).click()
  const quick = ownerPage.locator('.event-quick-popover')
  await expect(quick.getByText(/Times in/)).toBeVisible()
  await expect(quick.getByLabel('Description')).toHaveCount(0)
  await ownerPage.getByLabel('Title', { exact: true }).fill('Scratch')
  await ownerPage.keyboard.press('Escape')
  await expect(quick.getByText('Discard what you typed?')).toBeVisible()
  await quick.getByRole('button', { name: 'Discard' }).click()
  await expect(quick).toHaveCount(0)
  await ownerPage.getByRole('button', { name: 'New event' }).click()
  await ownerPage.getByLabel('Title', { exact: true }).fill('Welcome night')
  await fillRange(ownerPage, { date: '2026-10-20', time: '18:00' }, '17:00')
  await ownerPage.getByRole('button', { name: 'Create event' }).click()
  await expect(ownerPage.locator('[role="alert"], .app-error-text').first()).toBeVisible()
  await expect(ownerPage.getByLabel('Title', { exact: true })).toHaveValue('Welcome night')

  await ownerPage.getByLabel('End time', { exact: true }).fill('20:00')
  await ownerPage.screenshot({ path: 'test-results/release-evidence/quick-create-desktop.png' })
  await ownerPage.getByLabel('Title', { exact: true }).press('Enter')
  await expect(ownerPage).toHaveURL(/\/events\/[0-9a-f-]{36}$/)
  state.eventId = ownerPage.url().match(/\/events\/([0-9a-f-]{36})$/)![1]
  await expect(ownerPage.getByLabel('New to-do', { exact: true })).toBeFocused()
  await expect(ownerPage.getByRole('heading', { name: 'Welcome night' })).toBeVisible()
  await ownerPage.reload()
  await expect(ownerPage.getByRole('heading', { name: 'Welcome night' })).toBeVisible()
  await expect(ownerPage.getByText(/^Draft ·/)).toBeVisible()

  await ownerPage.goto(eventUrl('/tasks'))
  await ownerPage.getByLabel('New to-do', { exact: true }).fill('Set up welcome desk')
  await ownerPage.getByLabel('New to-do', { exact: true }).press('Enter')
  await expect(ownerPage.getByLabel('Title for Set up welcome desk')).toHaveValue('Set up welcome desk')
  await expect(ownerPage.getByLabel('New to-do', { exact: true })).toBeFocused()
  await ownerPage.getByRole('button', { name: 'Notes for Set up welcome desk' }).click()
  await ownerPage.getByLabel('Notes text for Set up welcome desk').fill('Table by the main doors.')
  await ownerPage.getByLabel('Notes text for Set up welcome desk').press('Control+Enter')
  await expect(ownerPage.locator('#before').getByText('Saved')).toBeVisible()
  await expect(ownerPage.getByRole('checkbox', { name: 'Done: Set up welcome desk' })).not.toBeChecked()

  await ownerPage.goto(eventUrl('/run-of-show'))
  await expect(ownerPage.getByLabel('Start for new item')).toHaveValue('6 PM')
  await ownerPage.getByLabel('Activity for new item').fill('Doors open')
  await ownerPage.getByLabel('Length for new item').fill('2h')
  await expect(ownerPage.getByText('Ends 8 PM')).toBeVisible()
  await ownerPage.getByLabel('Notes for new item').fill('Bring the sign-in sheet and markers.\nGreet people at the desk.')
  await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ownerPage.getByRole('button', { name: 'Edit Doors open', exact: true })).toBeVisible()
  await expect(ownerPage.getByLabel('Start for new item')).toHaveValue('8 PM')

  await ownerPage.getByRole('textbox', { name: 'Team briefing' }).fill('Volunteer call is 4:45 PM at the east lobby.\nPick up a badge and radio before the walkthrough.')
  await ownerPage.getByRole('button', { name: 'Save briefing' }).click()
  await addScheduleItem(ownerPage, { title: 'Room setup and AV check', start: '16:45', end: '17:15', assigned: true, notes: 'Place signs from the lobby to the room.\nTest the projector, microphone, captions, and clicker.' })
  await addScheduleItem(ownerPage, { title: 'Volunteer check-in', start: '17:15', end: '17:35', notes: 'Hand out badges, radios, and printed briefings.\nConfirm coverage for the accessible entrance.' })
  await addScheduleItem(ownerPage, { title: 'Team welcome', start: '17:35', end: '17:50', assigned: true, notes: 'Review exits, speaker names, timing cues, and the Q&A handoff.' })
  await addScheduleItem(ownerPage, { title: 'Project presentation', start: '18:30', end: '19:05', assigned: true, notes: 'Dim the front lights when the first slide appears.\nGive the speaker a five-minute cue and a one-minute cue.\nKeep captions visible throughout.' })
  await addScheduleItem(ownerPage, { title: 'Audience Q&A', start: '19:05', end: '19:25', notes: 'Bring the microphone to each questioner.\nSignal the moderator for the final question at 7:23 PM.' })
  await addScheduleItem(ownerPage, { title: 'Teardown and room handoff', start: '20:00', end: '20:45', assigned: true, notes: 'Collect radios, signs, and feedback cards.\nReturn furniture to the room diagram and check the quiet room.\nThe last organizer locks the doors.' })

  await ownerPage.reload()
  await expect(ownerPage.getByRole('textbox', { name: 'Team briefing' })).toHaveValue(/Volunteer call is 4:45 PM/)
  const everyone = await downloadPdf(ownerPage, { label: 'Everyone' })
  expect(everyone.name).toBe('welcome-night-run-of-show-everyone.pdf')
  expect(everyone.pages).toBeGreaterThanOrEqual(1)
  await expect(ownerPage.getByLabel('Show schedule for')).toHaveValue('everyone')
  await ownerPage.locator('#day-of').screenshot({ path: 'test-results/release-evidence/owner-schedule-desktop.png' })
})

test('3. owner edits status and the header updates without a reload', async () => {
  await ownerPage.goto(eventUrl('/edit'))
  await expect(ownerPage.getByRole('dialog', { name: 'Edit details' })).toBeVisible()
  await ownerPage.screenshot({ path: 'test-results/release-evidence/details-panel-desktop.png' })
  await ownerPage.getByLabel('Status').selectOption('planned')
  await ownerPage.getByRole('button', { name: 'Save' }).click()
  await expect(ownerPage).toHaveURL(new RegExp(`${state.eventId}$`))
  await expect(ownerPage.getByText(/^Planned ·/)).toBeVisible()
})

test('4. owner creates organizer and member invitations', async () => {
  await ownerPage.goto(`/app/w/${state.workspaceId}/settings?tab=team`)
  await ownerPage.getByLabel('Email', { exact: true }).fill(ORGANIZER)
  await ownerPage.getByLabel('Role', { exact: true }).selectOption('organizer')
  await ownerPage.getByRole('button', { name: 'Create link' }).click()
  await expect(ownerPage.getByLabel('Invitation link')).toHaveValue(/\/app\/invite\//)
  state.organizerLink = await ownerPage.getByLabel('Invitation link').inputValue()

  await ownerPage.getByLabel('Email', { exact: true }).fill(MEMBER)
  await ownerPage.getByLabel('Role', { exact: true }).selectOption('member')
  await ownerPage.getByRole('button', { name: 'Create link' }).click()
  await expect
    .poll(() => ownerPage.getByLabel('Invitation link').inputValue())
    .not.toBe(state.organizerLink)
  state.memberLink = await ownerPage.getByLabel('Invitation link').inputValue()
  await expect(ownerPage.locator('.app-team-row', { hasText: MEMBER })).toBeVisible()
})

test('5. member joins on a phone, sees no privileged navigation, and is denied direct privileged calls', async () => {
  await memberPage.goto(new URL(state.memberLink).pathname)
  await expect(memberPage.getByRole('heading', { name: 'Join a workspace' })).toBeVisible()
  await memberPage.getByRole('button', { name: 'Sign in to accept' }).click()
  await expect(memberPage).toHaveURL(/\/app\/sign-in\?return=/)
  await signIn(memberPage, MEMBER, new URL(state.memberLink).pathname)
  await expect(memberPage.getByRole('button', { name: 'Accept invitation' })).toBeVisible()
  await memberPage.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(memberPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home`))

  const menu = await openMobileMenu(memberPage)
  await expect(menu.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Events' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Tasks' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'People' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await memberPage.keyboard.press('Escape')
  await expect(memberPage.getByRole('button', { name: 'Menu' })).toBeFocused()

  await memberPage.goto(eventUrl())
  await expect(memberPage.getByRole('button', { name: 'Edit details' })).toHaveCount(0)
  await expect(memberPage.getByRole('link', { name: 'New event' })).toHaveCount(0)

  // Authorization lives in the database, not in hidden buttons.
  const denied = await memberPage.evaluate(async ({ workspaceId, url, key }) => {
    const raw = Object.keys(localStorage).find((item) => item.startsWith('sb-') && item.endsWith('-auth-token'))
    const session = raw ? JSON.parse(localStorage.getItem(raw) || '{}') : null
    const token = session?.access_token
    const response = await fetch(`${url}/rest/v1/rpc/create_event`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_workspace_id: workspaceId, p_title: 'Smuggled', p_description: '', p_location: '',
        p_starts_at: '2026-12-01T18:00:00Z', p_ends_at: '2026-12-01T20:00:00Z', p_timezone: 'America/New_York',
        p_lead_membership_id: null, p_request_key: crypto.randomUUID(),
      }),
    })
    return response.status
  }, { workspaceId: state.workspaceId, url: SUPABASE_URL, key: SUPABASE_ANON_KEY })
  expect(denied).toBeGreaterThanOrEqual(400)
})

test('6. owner assigns the task; member completes it at 375px and it persists', async () => {
  await ownerPage.goto(eventUrl('/tasks'))
  const assignee = ownerPage.getByLabel('Person for Set up welcome desk')
  // Unassigned, the owner, and the member who just joined.
  await expect(assignee.locator('option')).toHaveCount(3)
  const memberOption = await assignee.locator('option').evaluateAll((options) =>
    (options as HTMLOptionElement[]).find((option) => option.value && !/Owner QA/.test(option.textContent || ''))?.value ?? '')
  expect(memberOption).not.toBe('')
  await assignee.selectOption(memberOption)
  // Leaving the row saves it.
  await ownerPage.getByLabel('New to-do', { exact: true }).click()
  await expect(ownerPage.locator('#before').getByText('Saved')).toBeVisible()

  // Home is the member's to-do list; the old Tasks bookmark lands there.
  await memberPage.goto(`/app/w/${state.workspaceId}/tasks?assignee=me&status=open`)
  await expect(memberPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home$`))
  const todo = memberPage.getByRole('checkbox', { name: 'Set up welcome desk' })
  await expect(todo).not.toBeChecked()
  await expect(memberPage.getByRole('link', { name: 'Welcome night', exact: true })).toBeVisible()
  expect(await horizontalOverflow(memberPage)).toBeLessThanOrEqual(0)
  await todo.check()
  await expect(todo).toBeChecked()
  await expect(todo).toBeEnabled()
  await memberPage.screenshot({ path: 'test-results/release-evidence/member-home-375.png', fullPage: true })
  await memberPage.reload()
  await expect(memberPage.getByText('Nothing assigned to you yet')).toBeVisible()
  await memberPage.goto(eventUrl('/tasks'))
  await memberPage.locator('.todo-done > summary').click()
  await expect(memberPage.getByRole('checkbox', { name: 'Done: Set up welcome desk' })).toBeChecked()

  await ownerPage.goto(eventUrl())
  await expect(ownerPage.getByText('1 of 1 done')).toBeVisible()
})

test('7. member reads the full run of show at 375px without horizontal scroll', async () => {
  await memberPage.goto(eventUrl('/run-of-show'))
  await expect(memberPage.getByText('Doors open', { exact: true })).toBeVisible()
  await expect(memberPage.getByText('Bring the sign-in sheet and markers.')).toBeVisible()
  await expect(memberPage.getByText('Greet people at the desk.')).toBeVisible()
  await expect(memberPage.getByLabel('Activity for new item')).toHaveCount(0)
  await expect(memberPage.locator('.ros-row-menu')).toHaveCount(0)
  expect(await horizontalOverflow(memberPage)).toBeLessThanOrEqual(0)

  // Members start on Mine: their items plus Everyone items, never someone else's.
  const who = memberPage.getByLabel('Show schedule for')
  await expect(who).toHaveValue('mine')
  await expect(memberPage.getByText('Room setup and AV check', { exact: true })).toHaveCount(0)
  await memberPage.screenshot({ path: 'test-results/release-evidence/member-schedule-mine-375.png', fullPage: true })
  await who.selectOption('everyone')
  await expect(memberPage).toHaveURL(/[?&]who=everyone/)
  await expect(memberPage.getByText('Room setup and AV check', { exact: true })).toBeVisible()
  await memberPage.goto(eventUrl('/run-of-show'))
  await expect(memberPage.getByLabel('Show schedule for')).toHaveValue('everyone')
  expect(await horizontalOverflow(memberPage)).toBeLessThanOrEqual(0)

  // A teammate downloads their own PDF on a phone.
  const mine = await downloadPdf(memberPage, { value: 'mine' })
  expect(mine.name).toMatch(/^welcome-night-run-of-show-.+\.pdf$/)
  expect(mine.name).not.toContain('everyone')
})

test('8. organizer joins, can plan and manage attendance, but cannot administer the workspace', async () => {
  await organizerPage.goto(new URL(state.organizerLink).pathname)
  await organizerPage.getByRole('button', { name: 'Sign in to accept' }).click()
  await signIn(organizerPage, ORGANIZER, new URL(state.organizerLink).pathname)
  await organizerPage.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(organizerPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home`))
  await expect(organizerPage.getByRole('link', { name: 'Welcome night', exact: true })).toBeVisible()
  const nav = organizerPage.getByRole('navigation', { name: 'Workspace' })
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
  await organizerPage.screenshot({ path: 'test-results/release-evidence/organizer-home-desktop.png', fullPage: true })
  await organizerPage.getByRole('link', { name: 'Welcome night', exact: true }).click()
  await organizerPage.locator('.app-event-breadcrumb').getByRole('link', { name: 'Home' }).click()
  await expect(organizerPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home`))
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await organizerPage.goto(`/app/w/${state.workspaceId}/settings`)
  await expect(organizerPage.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible()
  await organizerPage.goto(eventUrl())
  await expect(organizerPage.getByRole('button', { name: 'Edit details' })).toBeVisible()
})

test('9. organizer imports overlapping batches; totals reconcile and reversion keeps shared evidence', async () => {
  const first = await importCsv(organizerPage, state.eventId, 'attendance-a.csv')
  expect(first).toContain('2 new')
  await expect(organizerPage.getByText('Active')).toBeVisible()
  await expect(organizerPage.getByText('2 attendees added · 0 already recorded · 0 rows skipped')).toBeVisible()
  const batchA = organizerPage.url()

  const second = await importCsv(organizerPage, state.eventId, 'attendance-b.csv')
  expect(second).toContain('1 new')
  expect(second).toContain('1 already recorded')
  await expect(organizerPage.getByText('1 attendees added · 1 already recorded · 0 rows skipped')).toBeVisible()

  await organizerPage.goto(eventUrl('/attendance?view=people'))
  await expect(organizerPage.getByText('3 distinct attendees recorded')).toBeVisible()
  for (const name of ['Ana', 'Bo', 'Cy']) {
    await expect(organizerPage.getByRole('link', { name, exact: true })).toBeVisible()
  }

  await organizerPage.goto(batchA)
  await organizerPage.getByRole('button', { name: 'Revert import' }).click()
  const dialog = organizerPage.getByRole('dialog')
  await expect(dialog).toContainText('1 attendance records will disappear. 1 people remain')
  await dialog.getByRole('button', { name: 'Revert import' }).click()
  await expect(organizerPage.getByText('Reverted')).toBeVisible()
  await expect(organizerPage.getByRole('button', { name: 'Revert import' })).toHaveCount(0)

  await organizerPage.goto(eventUrl('/attendance?view=people'))
  await expect(organizerPage.getByText('2 distinct attendees recorded')).toBeVisible()
  await expect(organizerPage.getByRole('link', { name: 'Ana', exact: true })).toHaveCount(0)
  await expect(organizerPage.getByRole('link', { name: 'Bo', exact: true })).toBeVisible()
  await expect(organizerPage.getByRole('link', { name: 'Cy', exact: true })).toBeVisible()
  await organizerPage.goto(eventUrl('/attendance?view=imports'))
  await expect(organizerPage.getByText('Reverted')).toBeVisible()
  await expect(organizerPage.getByText('Active')).toBeVisible()

  // A member sees the scalar count but never names or emails.
  await memberPage.goto(eventUrl())
  await expect(memberPage.getByText('2 attendees recorded')).toBeVisible()
  await memberPage.goto(eventUrl('/attendance'))
  await expect(memberPage.getByText('bo.qa@example.test')).toHaveCount(0)
})

test('10. duplicate makes a clean draft; cross-event history counts each event once', async () => {
  await organizerPage.goto(eventUrl())
  await organizerPage.getByRole('link', { name: 'Duplicate' }).click()
  await expect(organizerPage.getByLabel('Title', { exact: true })).toHaveValue('Welcome night copy')
  await expect(organizerPage.getByLabel('Description')).toHaveCount(0)
  await organizerPage.getByLabel('Start date', { exact: true }).fill('2026-11-03')
  await organizerPage.getByRole('button', { name: 'Create copy' }).click()
  await expect(organizerPage).toHaveURL(/\/events\/[0-9a-f-]{36}$/)
  state.copyEventId = organizerPage.url().match(/\/events\/([0-9a-f-]{36})$/)![1]
  expect(state.copyEventId).not.toBe(state.eventId)
  await expect(organizerPage.getByText(/^Draft ·/)).toBeVisible()
  await expect(organizerPage.getByText('Attendance hasn’t been recorded')).toBeVisible()

  await organizerPage.goto(`/app/w/${state.workspaceId}/events/${state.copyEventId}/tasks`)
  await expect(organizerPage.getByRole('checkbox', { name: 'Done: Set up welcome desk' })).not.toBeChecked()
  await expect(organizerPage.getByLabel('Person for Set up welcome desk')).toHaveValue('')

  // Ten to-dos with the keyboard only: type, Tab to the date, Enter, repeat.
  const newTodo = organizerPage.getByLabel('New to-do', { exact: true })
  await newTodo.focus()
  for (let index = 1; index <= 10; index += 1) {
    await organizerPage.keyboard.type(`Keyboard to-do ${index}`)
    if (index === 1) {
      await organizerPage.keyboard.press('Tab')
      await organizerPage.keyboard.type('10/19')
    }
    await organizerPage.keyboard.press('Enter')
    await expect(organizerPage.getByLabel(`Title for Keyboard to-do ${index}`)).toBeVisible()
    await expect(newTodo).toBeFocused()
  }
  await organizerPage.screenshot({ path: 'test-results/release-evidence/organizer-before-desktop.png', fullPage: true })
  await organizerPage.reload()
  await expect(organizerPage.getByLabel('Title for Keyboard to-do 10')).toBeVisible()
  await expect(organizerPage.getByLabel('Date for Keyboard to-do 10')).toHaveValue('Mon, Oct 19')

  await importCsv(organizerPage, state.copyEventId, 'attendance-b.csv')
  await organizerPage.goto(`/app/w/${state.workspaceId}/attendance`)
  await expect(organizerPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/people`))
  await expect(organizerPage.getByRole('heading', { name: 'People' })).toBeVisible()
  await expect(organizerPage.getByText(/bo\.qa@example\.test · 2 events/)).toBeVisible()
  await expect(organizerPage.getByText(/cy\.qa@example\.test · 2 events/)).toBeVisible()
  await expect(organizerPage.getByText(/ana\.qa@example\.test/)).toHaveCount(0)
  await organizerPage.getByRole('link', { name: 'Bo', exact: true }).click()
  await expect(organizerPage.getByText(/^2 events/)).toBeVisible()
  await expect(organizerPage.getByRole('link', { name: 'Welcome night', exact: true })).toBeVisible()
  await expect(organizerPage.getByRole('link', { name: 'Welcome night copy' })).toBeVisible()

  await memberPage.goto(`/app/w/${state.workspaceId}/attendance`)
  await expect(memberPage.getByText(/bo\.qa@example\.test/)).toHaveCount(0)
})

test('11. simultaneous edits conflict instead of silently overwriting', async () => {
  const second = await owner.newPage()
  await ownerPage.goto(eventUrl('/edit'))
  await second.goto(eventUrl('/edit'))
  await expect(second.getByLabel('Title', { exact: true })).toHaveValue('Welcome night')

  await ownerPage.getByLabel('Location').fill('Student center')
  await ownerPage.getByRole('button', { name: 'Save' }).click()
  await expect(ownerPage).toHaveURL(new RegExp(`${state.eventId}$`))

  await second.getByLabel('Title', { exact: true }).fill('Welcome night (stale)')
  await second.getByRole('button', { name: 'Save' }).click()
  await expect(second.getByText('This event changed. Reload the latest version.')).toBeVisible()
  await expect(second).toHaveURL(/details=1/)
  await expect(second.getByLabel('Title', { exact: true })).toHaveValue('Welcome night (stale)')
  await second.close()

  await ownerPage.reload()
  await expect(ownerPage.getByRole('heading', { name: 'Welcome night', exact: true })).toBeVisible()
  await expect(ownerPage.locator('.event-header').getByText('Student center')).toBeVisible()
})

test('12. archive hides and freezes the event; restore brings the plan back', async () => {
  await ownerPage.goto(`/app/w/${state.workspaceId}/events`)
  ownerPage.once('dialog', (dialog) => dialog.accept())
  const row = ownerPage.locator('.app-event-row', { hasText: 'Welcome night' }).filter({ hasNotText: 'copy' }).first()
  await row.getByRole('button', { name: 'Archive' }).click()
  await expect(ownerPage.getByRole('link', { name: 'Welcome night', exact: true })).toHaveCount(0)

  await memberPage.goto(eventUrl())
  await expect(memberPage.getByText('This event is archived. Restore it to edit the plan.')).toBeVisible()
  await memberPage.goto(eventUrl('/tasks'))
  await memberPage.locator('.todo-done > summary').click()
  await expect(memberPage.getByRole('checkbox', { name: 'Done: Set up welcome desk' })).toBeDisabled()

  await ownerPage.getByRole('button', { name: 'Archived' }).click()
  ownerPage.once('dialog', (dialog) => dialog.accept())
  await ownerPage.getByRole('button', { name: 'Restore' }).first().click()
  await ownerPage.getByRole('button', { name: 'Upcoming' }).click()
  await expect(ownerPage.getByRole('link', { name: 'Welcome night', exact: true })).toBeVisible()
  await ownerPage.goto(eventUrl('/run-of-show'))
  await expect(ownerPage.getByRole('button', { name: 'Edit Doors open', exact: true })).toBeVisible()
})

test('13. a filtered deep link survives sign-out and sign-in', async () => {
  const target = `/app/w/${state.workspaceId}/people?q=bo`
  await signOut(ownerPage)
  await ownerPage.goto(target)
  await expect(ownerPage).toHaveURL(/\/app\/sign-in\?return=/)
  await signIn(ownerPage, OWNER, target)
  await expect(ownerPage).toHaveURL(new RegExp(`${state.workspaceId}/people\\?q=bo`))
  await expect(ownerPage.getByPlaceholder('Search names or emails')).toHaveValue('bo')
  await expect(ownerPage.getByRole('link', { name: 'Bo', exact: true })).toBeVisible()
  await expect(ownerPage.getByRole('link', { name: 'Cy', exact: true })).toHaveCount(0)
})

test('14. another workspace cannot read this one', async ({ browser }) => {
  const outsider = await browser.newContext()
  const page = await outsider.newPage()
  await signIn(page, OUTSIDER)
  await expect(page).toHaveURL(/\/app\/new-workspace/)
  await page.getByLabel('Workspace name').fill(`Other Club ${STAMP}`)
  await page.getByLabel('Your display name').fill('Outsider QA')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page).toHaveURL(/\/app\/w\/[0-9a-f-]{36}\/home/)

  await page.goto(eventUrl())
  await expect(page.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible()
  await expect(page.getByText('Welcome night')).toHaveCount(0)
  await page.goto(`/app/w/${state.workspaceId}/people`)
  await expect(page.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible()
  await outsider.close()
})

test('15. removing the member revokes access on their next request and keeps history', async () => {
  await ownerPage.goto(`/app/w/${state.workspaceId}/settings?tab=team`)
  const memberRow = ownerPage.locator('.app-team-row', { hasText: MEMBER })
  await memberRow.getByRole('button', { name: 'Remove' }).click()
  const dialog = ownerPage.getByRole('dialog')
  await expect(dialog).toContainText('will lose access to this workspace')
  await dialog.getByRole('button', { name: 'Remove teammate' }).click()
  await expect(ownerPage.locator('.app-team-row', { hasText: MEMBER })).toHaveCount(0)

  await memberPage.goto(`/app/w/${state.workspaceId}/home`)
  await expect(memberPage.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible()
  await expect(memberPage.getByRole('checkbox', { name: 'Done: Set up welcome desk' })).toHaveCount(0)

  await ownerPage.goto(eventUrl('/tasks'))
  await ownerPage.locator('.todo-done > summary').click()
  await expect(ownerPage.getByLabel('Person for Set up welcome desk').locator('option:checked')).toHaveText('Former member')
})

test('16. a dropped backend on reload shows a recoverable error, never a false onboarding screen', async () => {
  // Cut only the Supabase connection; the static app itself still loads.
  const backend = new URL(SUPABASE_URL)
  const cut = `${backend.protocol}//${backend.host}/**`
  await owner.route(cut, (route) => route.abort('connectionrefused'))
  await ownerPage.goto('/app')
  await expect(ownerPage.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 20_000 })
  await expect(ownerPage.getByRole('heading', { name: 'Create a workspace' })).toHaveCount(0)
  await owner.unroute(cut)
  await ownerPage.getByRole('button', { name: 'Retry' }).click()
  await expect(ownerPage).toHaveURL(new RegExp(`/app/w/${state.workspaceId}/home`), { timeout: 20_000 })
})
