import type { Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { createOrReplaceInvitation } from '../src/lib/invitations.js'
import { signSession } from '../src/lib/session.js'

export async function seedWorkspace(label: string) {
  const owner = await prisma.user.create({
    data: { email: `${label}-owner@e2e.test`, name: 'Owner' },
  })
  const workspace = await prisma.workspace.create({ data: { name: label, ownerId: owner.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: 'owner' },
  })
  return { owner, workspace }
}

export async function addMember(workspaceId: string, label: string, role: Role) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${role}@e2e.test`,
      name: role === 'viewer' ? 'Vera' : 'Eddie',
    },
  })
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } })
  return user
}

export async function createDocument(workspaceId: string, type: 'doc' | 'board') {
  return prisma.document.create({ data: { workspaceId, type, title: `e2e ${type}` } })
}

/**
 * The canonical URL for a seeded document. Takes the row rather than two ids so
 * call sites cannot pair a document with the wrong workspace.
 */
export function documentPath(document: { id: string; workspaceId: string }): string {
  return `/workspaces/${document.workspaceId}/documents/${document.id}`
}

export async function sessionCookieFor(userId: string) {
  return {
    name: 'crdt_session',
    value: await signSession(userId, process.env.SESSION_SECRET!),
    domain: 'localhost',
    path: '/',
  }
}

/**
 * Signs a browser in by setting the session cookie directly. A real GitHub or
 * Google sign-in cannot be scripted, and the OAuth flow itself is covered by
 * oauth-routes.integration.test.ts; this is what every other e2e test uses.
 */
export async function signIn(page: Page, userId: string) {
  await page.context().addCookies([await sessionCookieFor(userId)])
}

export async function cleanup(label: string) {
  await prisma.workspace.deleteMany({ where: { name: label } })
  await prisma.user.deleteMany({ where: { email: { contains: `${label}-` } } })
}

/**
 * A pending invitation, made exactly as the members route makes one. Returns its id and
 * its link's path (/invite/<token>); the token exists nowhere else.
 */
export async function invite(input: {
  workspaceId: string
  invitedById: string
  email: string
  role: Role
  documentId?: string
}) {
  const { invitation, link } = await createOrReplaceInvitation({
    ...input,
    documentId: input.documentId ?? null,
  })
  return { id: invitation.id, link }
}
