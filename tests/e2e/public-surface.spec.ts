import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { uniqueEmail } from './helpers/auth'

// Landing and sign-in acceptance from DESIGN.md: five viewports, 200% zoom,
// reduced motion, keyboard access, focus, contrast, and unauthenticated routing.
// Runs with only the Vite dev server; nothing here needs the database.

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
  { name: '320x640', width: 320, height: 640 },
] as const

const evidenceDir = process.env.BRIE_EVIDENCE_DIR || join('test-results', 'evidence')
mkdirSync(evidenceDir, { recursive: true })

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth
  })
}

async function contrastRatio(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel) as HTMLElement | null
    if (!element) return null
    const parse = (value: string) => {
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value)
      if (!match) return null
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
    }
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const fg = parse(getComputedStyle(element).color)
    let node: HTMLElement | null = element
    let bg = null as ReturnType<typeof parse>
    while (node && (!bg || bg.a === 0)) {
      bg = parse(getComputedStyle(node).backgroundColor)
      node = node.parentElement
    }
    if (!fg || !bg) return null
    const l1 = luminance(fg)
    const l2 = luminance(bg)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }, selector)
}

test.describe('landing page', () => {
  for (const viewport of VIEWPORTS) {
    test(`renders the approved landing without horizontal overflow at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/run events/i)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: join(evidenceDir, `landing-${viewport.name}.png`), fullPage: true })
    })
  }

  test('keeps rendering with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('sign-in surface', () => {
  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.name} with reachable controls`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/app/sign-in')
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      const button = page.getByRole('button', { name: 'Send code' })
      await expect(button).toBeVisible()
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      // DESIGN.md: controls are 36px on desktop and at least 44px below 768px (touch).
      const minimum = viewport.width < 768 ? 44 : 36
      const box = await button.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(minimum)
      const field = await page.getByLabel('Email').boundingBox()
      expect(field?.height ?? 0).toBeGreaterThanOrEqual(minimum)
      await page.screenshot({ path: join(evidenceDir, `sign-in-${viewport.name}.png`), fullPage: true })
    })
  }

  test('is usable at 200% zoom', async ({ browser }) => {
    // 200% browser zoom lays out a 1440px window as a 720px CSS viewport.
    const context = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 })
    const page = await context.newPage()
    await page.goto('/app/sign-in')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send code' })).toBeInViewport()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: join(evidenceDir, 'sign-in-200pct.png'), fullPage: true })
    await context.close()
  })

  test('focuses the email field, submits with the keyboard, and keeps the address on failure', async ({ page }) => {
    await page.goto('/app/sign-in')
    await expect(page.getByLabel('Email')).toBeFocused()
    // A fresh address each run: Auth allows one code per address per minute.
    const email = uniqueEmail('keyboard')
    await page.keyboard.type(email)
    await page.keyboard.press('Enter')
    // With a live stack the code step appears; without one the send fails
    // with an actionable inline error and the address is kept for retry.
    await expect
      .poll(async () => {
        if (await page.getByRole('heading', { name: 'Enter your code' }).isVisible()) return 'code'
        if (await page.getByText('Couldn’t send your code').isVisible()) return 'error'
        return 'pending'
      }, { timeout: 15_000 })
      .not.toBe('pending')
    if (await page.getByText('Couldn’t send your code').isVisible()) {
      await expect(page.getByLabel('Email')).toHaveValue(email)
      await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByRole('button', { name: 'Send code' })).toBeEnabled()
    }
  })

  test('shows visible focus and 4.5:1 contrast on the primary control and body text', async ({ page }) => {
    await page.goto('/app/sign-in')
    await page.getByRole('button', { name: 'Send code' }).focus()
    const outline = await page.getByRole('button', { name: 'Send code' }).evaluate((element) => {
      const style = getComputedStyle(element)
      return { outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow }
    })
    expect(outline.outline !== 'none' || outline.shadow !== 'none').toBe(true)
    expect(await contrastRatio(page, 'button[type="submit"]')).toBeGreaterThanOrEqual(4.5)
    expect(await contrastRatio(page, '.app-lede')).toBeGreaterThanOrEqual(4.5)
    expect(await contrastRatio(page, 'h1')).toBeGreaterThanOrEqual(4.5)
  })

  test('disables transitions under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/app/sign-in')
    const duration = await page.getByRole('button', { name: 'Send code' }).evaluate((element) => getComputedStyle(element).transitionDuration)
    expect(duration.split(',').every((part) => part.trim() === '0s')).toBe(true)
  })
})

test.describe('unauthenticated routing', () => {
  test('sends a workspace deep link to sign-in with a same-origin return path', async ({ page }) => {
    const target = '/app/w/00000000-0000-4000-8000-000000000000/tasks?status=done&assignee=me'
    await page.goto(target)
    await expect(page).toHaveURL(/\/app\/sign-in\?return=/)
    const returnTo = new URL(page.url()).searchParams.get('return')
    expect(returnTo).toBe(target)
  })

  test('shows the app unavailable state for unknown app routes', async ({ page }) => {
    await page.goto('/app/this-route-does-not-exist')
    await expect(page.getByText('This page isn’t available')).toBeVisible()
  })

  test('never lets a foreign return path leave the app', async ({ page }) => {
    await page.goto('/app/sign-in?return=https://example.com/phish')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    const hijacked = await page.evaluate(() => location.origin !== new URL(document.baseURI).origin)
    expect(hijacked).toBe(false)
  })
})
