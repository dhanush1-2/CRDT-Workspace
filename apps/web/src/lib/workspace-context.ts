import { cache } from 'react'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { HttpError, requireWorkspaceRole } from './auth-guard.js'
import type { WorkspaceMemberView } from './members.js'

export type WorkspaceContext = {
  role: Role
  name: string
  documents: { id: string; title: string; type: 'doc' | 'board'; createdAt: Date }[]
  members: WorkspaceMemberView[]
}

/**
 * Everything the workspace nav and the pages under it need, loaded once.
 *
 * React's cache() memoises the result for the duration of one render, so the layout
 * and the page inside it share a single pair of queries rather than each running its
 * own. Both arguments are part of the key: the role is part of the result, so a memo
 * shared between users would be an access-control bug, not a performance win.
 *
 * Throws HttpError(404) for a workspace the caller is not a member of — the same
 * shape requireWorkspaceRole uses, so callers keep their existing 404 handling and a
 * non-member cannot tell a private workspace from one that does not exist.
 */
export const loadWorkspaceContext = cache(
  async (workspaceId: string, userId: string): Promise<WorkspaceContext> => {
    const role = await requireWorkspaceRole(userId, workspaceId, 'viewer')

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        name: true,
        documents: {
          select: { id: true, title: true, type: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        members: {
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
          orderBy: { user: { name: 'asc' } },
        },
      },
    })
    // A membership row for a workspace that no longer exists: possible only in a
    // race with a delete, and the caller already handles 404.
    if (!workspace) throw new HttpError(404, 'not found')

    return {
      role,
      name: workspace.name,
      documents: workspace.documents,
      members: workspace.members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
      })),
    }
  },
)
