/**
 * Regenerates the screenshots in docs/images/ that the README embeds.
 *
 * Run it rather than taking screenshots by hand, so the images can be refreshed
 * after a UI change instead of slowly going stale:
 *
 *   docker compose up -d
 *   pnpm --filter @crdt/sync run dev          # port 1234
 *   pnpm --filter @crdt/web run dev           # port 3000
 *   pnpm --filter @crdt/web exec tsx scripts/screenshots.ts
 *
 * It seeds its own throwaway workspace, captures, then deletes it, so it leaves
 * no residue in the database.
 * It signs browsers in by setting the session cookie directly, the same way the
 * Playwright fixtures do.
 */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import * as Y from 'yjs'
import { addCard, addColumn } from '@crdt/shared/board'
import { signSession } from '../src/lib/session.js'

const WEB = 'http://localhost:3000'
// Resolved from this file, so the script works from any working directory.
const OUT = fileURLToPath(new URL('../../../docs/images', import.meta.url))
// The exact rows this script owns. Everything here is created and then deleted;
// nothing else in the database is touched.
const EMAILS = ['ada@example.com', 'grace@example.com', 'vera@example.com']
const WORKSPACES = ['Product', 'Personal notes']

const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) throw new Error('SESSION_SECRET must be set (it comes from .env)')

/** A board with realistic content, written through the same update log the sync server uses. */
function demoBoard(): Uint8Array {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'backlog', title: 'Backlog' })
  addColumn(doc, { id: 'progress', title: 'In progress' })
  addColumn(doc, { id: 'done', title: 'Done' })
  addCard(doc, { id: 'c1', title: 'Rate-limit the token endpoint', columnId: 'backlog' })
  addCard(doc, { id: 'c2', title: 'Prune the update log past the snapshot', columnId: 'backlog' })
  addCard(doc, { id: 'c3', title: 'Offline merge: 5-minute disconnect', columnId: 'progress' })
  addCard(doc, { id: 'c4', title: 'Enforce roles inside the sync protocol', columnId: 'done' })
  return Y.encodeStateAsUpdate(doc)
}

async function seed() {
  const [owner, editor, viewer] = await Promise.all([
    prisma.user.create({
      data: { email: EMAILS[0]!, name: 'Ada', passwordHash: 'unused' },
    }),
    prisma.user.create({
      data: { email: EMAILS[1]!, name: 'Grace', passwordHash: 'unused' },
    }),
    prisma.user.create({
      data: { email: EMAILS[2]!, name: 'Vera', passwordHash: 'unused' },
    }),
  ])

  const workspace = await prisma.workspace.create({
    data: {
      name: WORKSPACES[0]!,
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          { userId: editor.id, role: 'editor' },
          { userId: viewer.id, role: 'viewer' },
        ],
      },
    },
  })

  // A second workspace, so the dashboard shows a list rather than one row.
  await prisma.workspace.create({
    data: {
      name: WORKSPACES[1]!,
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: 'owner' } },
    },
  })

  const board = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'board', title: 'Launch board' },
  })
  await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'Architecture notes' },
  })
  await prisma.documentUpdate.create({
    data: { documentId: board.id, update: Buffer.from(demoBoard()), clientId: 'shots' },
  })

  return { owner, editor, viewer, workspace, board }
}

async function cleanup() {
  const owned = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })
  // Workspace.ownerId is a plain column, not a relation, so deleting the users
  // does not cascade to their workspaces. Remove the workspaces first.
  await prisma.workspace.deleteMany({ where: { ownerId: { in: owned.map((u) => u.id) } } })
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } })
}

async function openAs(
  browser: Browser,
  userId: string,
  path: string,
  size: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 })
  await context.addCookies([
    {
      name: 'crdt_session',
      value: await signSession(userId, SESSION_SECRET!),
      domain: 'localhost',
      path: '/',
    },
  ])
  const page = await context.newPage()
  // The floating Next.js dev-tools badge is part of the dev server, not the
  // product, and has no business in a screenshot.
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = 'nextjs-portal,[data-nextjs-toast]{display:none !important}'
    document.addEventListener('DOMContentLoaded', () => document.head.append(style))
  })
  // ?nobc=1 forces each window through the server rather than the cross-tab
  // BroadcastChannel, so the screenshots show real network sync.
  await page.goto(`${WEB}${path}${path.includes('/documents/') ? '?nobc=1' : ''}`)
  return page
}

async function main() {
  await cleanup()
  await mkdir(OUT, { recursive: true })
  const { owner, editor, viewer, workspace, board } = await seed()
  const browser = await chromium.launch()

  // Heights are tuned per page so each image is content, not whitespace.
  const dashboardSize = { width: 1280, height: 470 }
  const workspaceSize = { width: 1280, height: 820 }
  const boardSize = { width: 880, height: 440 }

  // 1. The dashboard a signed-in person lands on.
  const dashboard = await openAs(browser, owner.id, '/', dashboardSize)
  await dashboard.getByTestId('current-user').waitFor()
  await dashboard.screenshot({ path: `${OUT}/dashboard.png` })

  // 2. A workspace: its documents, and the members panel with all three roles.
  const ws = await openAs(browser, owner.id, `/workspaces/${workspace.id}`, workspaceSize)
  await ws.getByTestId(`member-${viewer.id}`).waitFor()
  await ws.screenshot({ path: `${OUT}/workspace.png` })

  // 3. The same board open as two different people, syncing over the server.
  const windowA = await openAs(browser, owner.id, `/workspaces/${workspace.id}/documents/${board.id}`, boardSize)
  const windowB = await openAs(browser, editor.id, `/workspaces/${workspace.id}/documents/${board.id}`, boardSize)
  for (const page of [windowA, windowB]) {
    await page.getByTestId('status').filter({ hasText: 'connected' }).waitFor()
  }

  // Grace adds a card; it must appear in Ada's window, which is the whole point.
  await windowB.getByTestId('add-card-progress').click()
  await windowA.locator('[data-testid^="card-"]').nth(4).waitFor()

  // Grace hovers a card, so Ada's window shows "Grace is editing" under it.
  await windowB.getByTestId('card-c3').hover()
  await windowA.getByTestId('card-presence-c3').waitFor()

  await windowA.screenshot({ path: `${OUT}/board-window-a.png` })
  await windowB.screenshot({ path: `${OUT}/board-window-b.png` })

  // 4. A viewer: same board, live updates, but no controls and a read-only badge.
  const viewerPage = await openAs(browser, viewer.id, `/workspaces/${workspace.id}/documents/${board.id}`, boardSize)
  await viewerPage.getByTestId('read-only').waitFor()
  await viewerPage.screenshot({ path: `${OUT}/viewer-read-only.png` })

  await browser.close()
  await cleanup()
  await prisma.$disconnect()
  console.log(`wrote 5 screenshots to ${OUT}/`)
}

await main()
