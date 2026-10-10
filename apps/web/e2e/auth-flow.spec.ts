import { test, expect } from '@playwright/test'
import { prisma } from '@crdt/db'
import {
  addMember,
  cleanup,
  createDocument,
  documentPath,
  seedWorkspace,
  signIn,
} from './fixtures.js'

const LABEL = 'e2e-auth'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the login page offers GitHub and Google sign-in, carrying the destination', async ({ page }) => {
  await page.goto('/login?next=/workspaces/abc')
  await expect(page.getByTestId('signin-github')).toHaveAttribute(
    'href',
    '/api/auth/oauth/github?next=%2Fworkspaces%2Fabc',
  )
  await expect(page.getByTestId('signin-google')).toHaveAttribute(
    'href',
    '/api/auth/oauth/google?next=%2Fworkspaces%2Fabc',
  )
})

test('the privacy policy is public and linked from the login page', async ({ page }) => {
  // Google will not publish the consent screen without a privacy policy URL it can load
  // signed out, so this page must never sit behind sign-in.
  await page.goto('/login')
  await page.getByTestId('privacy-link').click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'cdhanush1223@gmail.com' }).first()).toHaveAttribute(
    'href',
    'mailto:cdhanush1223@gmail.com',
  )
})

test('a hostile next param never reaches the sign-in buttons', async ({ page }) => {
  await page.goto('/login?next=//evil.example')
  await expect(page.getByTestId('signin-github')).toHaveAttribute('href', '/api/auth/oauth/github?next=%2F')
})

test('a repeated next param does not crash the login page', async ({ page }) => {
  const response = await page.goto('/login?next=/a&next=/b')
  expect(response?.status()).toBe(200)
  await expect(page.getByTestId('signin-github')).toHaveAttribute('href', '/api/auth/oauth/github?next=%2F')
})

test('continuing with GitHub sends the browser to GitHub with state and PKCE', async ({ page }) => {
  // Never actually load github.com: capture the navigation and abort it.
  await page.route('https://github.com/**', (route) => route.abort())
  await page.goto('/login')

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith('https://github.com/login/oauth/authorize')),
    page.getByTestId('signin-github').click(),
  ])

  const url = new URL(request.url())
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oauth/github/callback')
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(url.searchParams.get('client_id')).toBeTruthy()
})

test('a known sign-in error shows its fixed message', async ({ page }) => {
  await page.goto('/login?error=state_mismatch')
  await expect(page.getByTestId('auth-error')).toContainText('expired or was started in another tab')
})

test('an unknown error code shows a generic message, never the raw text', async ({ page }) => {
  await page.goto(`/login?error=${encodeURIComponent('Call 555-0100 to verify your account')}`)
  await expect(page.getByTestId('auth-error')).toHaveText('Sign-in failed. Please try again.')
  await expect(page.getByText('555-0100')).toHaveCount(0)
})

test('/signup forwards to /login and keeps the destination', async ({ page }) => {
  await page.goto('/signup?next=/workspaces/abc')
  await expect(page).toHaveURL('/login?next=%2Fworkspaces%2Fabc')
})

test('the old password endpoints are gone', async ({ request }) => {
  // If either route still existed, anyone could create an account for an email
  // they do not own with a single curl command.
  const login = await request.post('/api/auth/login', {
    data: { email: 'someone@e2e.test', password: 'x'.repeat(12) },
  })
  const signup = await request.post('/api/auth/signup', {
    data: { email: 'someone@e2e.test', password: 'x'.repeat(12), name: 'Someone' },
  })
  expect(login.status()).toBe(404)
  expect(signup.status()).toBe(404)
})

test('a signed-in visitor to /login goes straight to their destination', async ({ page }) => {
  const label = `${LABEL}-already`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/login?next=/')
  await expect(page).toHaveURL('/')

  await cleanup(label)
})

test('the dashboard lists the workspaces you belong to and can create another', async ({ page }) => {
  const label = `${LABEL}-dash`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/')
  // The signed-in identity moved into the account menu in the Glass nav.
  await page.getByLabel('Account').click()
  await expect(page.getByTestId('current-user')).toHaveText('Owner')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toContainText(label)

  await page.getByTestId('workspace-name').fill(`${label}-second`)
  await page.getByTestId('create-workspace').click()
  await expect(page.getByText(`${label}-second`)).toBeVisible()

  await page.getByLabel('Account').click()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL('/login')

  await cleanup(label)
  await cleanup(`${label}-second`)
})

test('an unauthenticated visit to the dashboard sends you to sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('a workspace page lists its documents and can create a board', async ({ page }) => {
  const label = `${LABEL}-ws`
  const { owner, workspace } = await seedWorkspace(label)
  const existing = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto('/')
  await page.getByTestId(`workspace-${workspace.id}`).click()
  await expect(page).toHaveURL(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`document-${existing.id}`)).toContainText('e2e doc')

  await page.getByTestId('document-title').fill('Launch board')
  await page.getByRole('radio', { name: 'Board' }).check()
  await page.getByTestId('create-document').click()
  await expect(page.getByTestId('document-list')).toContainText('Launch board')

  await cleanup(label)
})

test('a workspace you are not a member of is not found, not forbidden', async ({ page }) => {
  const mine = `${LABEL}-mine`
  const theirs = `${LABEL}-theirs`
  const { owner } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)
  await signIn(page, owner.id)

  // 404, never 403: a 403 would confirm the id exists to somebody with no access.
  const response = await page.goto(`/workspaces/${other.workspace.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('a document in a workspace you are not a member of is not found, not forbidden', async ({ page }) => {
  const mine = `${LABEL}-docmine`
  const theirs = `${LABEL}-doctheirs`
  const { owner } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)
  const otherDocument = await createDocument(other.workspace.id, 'doc')
  await signIn(page, owner.id)

  // The legacy path on purpose: it proves the redirect route also 404s rather than
  // leaking a workspace id. routing.spec.ts covers the canonical path's 404.
  // Redirects are not followed: following one would land on the canonical page, which
  // 404s on its own, hiding a legacy route that redirected before checking access.
  const response = await page.request.get(`/documents/${otherDocument.id}`, { maxRedirects: 0 })
  expect(response.status()).toBe(404)
  expect(response.headers()['location']).toBeUndefined()
  expect(await response.text()).not.toContain(other.workspace.id)

  await cleanup(mine)
  await cleanup(theirs)
})

test('an owner sees the member list and can invite an existing user', async ({ page }) => {
  const label = `${LABEL}-members`
  const { owner, workspace } = await seedWorkspace(label)
  const invitee = await addMember(workspace.id, `${label}-pre`, 'viewer')
  const outsider = await seedWorkspace(`${label}-outsider`)
  await signIn(page, owner.id)

  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`member-${invitee.id}`)).toContainText('Can view')
  await expect(page.getByTestId(`member-${owner.id}`)).toContainText('Owner')

  // The invite form lives in the share sheet now.
  await page.getByTestId('share').click()

  // The invite options: visible labels, and the raw values the API receives. The
  // values staying intact is what keeps selectOption('editor') working. An <option>
  // has no .value that toHaveValue accepts (it is for inputs and selects), so read
  // the attribute; the select's own value is asserted via toHaveValue below.
  const options = page.getByTestId('member-role').locator('option')
  await expect(options).toHaveText(['Can view', 'Can edit', 'Owner'])
  await expect(options.nth(0)).toHaveAttribute('value', 'viewer')
  await expect(options.nth(1)).toHaveAttribute('value', 'editor')
  await expect(options.nth(2)).toHaveAttribute('value', 'owner')

  await page.getByTestId('member-email').fill(outsider.owner.email)
  await page.getByTestId('member-role').selectOption('editor')
  await expect(page.getByTestId('member-role')).toHaveValue('editor')
  await page.getByTestId('add-member').click()
  // Exactly as before invite links: added at once, no link shown, nothing pending.
  await expect(page.getByTestId('toast').filter({ hasText: `${outsider.owner.email} added` })).toBeVisible()
  await expect(page.getByTestId('invite-link-panel')).toHaveCount(0)
  expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(0)
  await expect(page.getByTestId(`member-${outsider.owner.id}`)).toContainText('Can edit')

  await cleanup(label)
  await cleanup(`${label}-outsider`)
})

test('an unauthenticated visit to a document redirects to sign-in carrying the destination', async ({
  page,
}) => {
  const label = `${LABEL}-doc`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')

  await page.goto(`/documents/${document.id}`)
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/documents/${document.id}`)}`)
  await expect(page.getByTestId('signin-github')).toHaveAttribute(
    'href',
    `/api/auth/oauth/github?next=${encodeURIComponent(`/documents/${document.id}`)}`,
  )

  // The return trip through OAuth is covered by oauth-routes.integration.test.ts;
  // here, confirm the destination itself works once signed in.
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page).toHaveURL(documentPath(document))
  await expect(page.locator('[aria-current="page"]')).toHaveText('e2e board')
  await expect(page.getByTestId('workspace-link')).toHaveText(label)
  // The design has no role indicator for owners; only viewers get the View only pill.
  await expect(page.getByTestId('view-only')).toHaveCount(0)

  await cleanup(label)
})
