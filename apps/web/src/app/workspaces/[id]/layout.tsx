import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { HttpError } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { loadWorkspaceContext } from '@/lib/workspace-context'

/**
 * The nav for everything inside a workspace: the overview and every document.
 *
 * It lives here rather than in each page so that it is not remounted when you move
 * between them. The sliding tab indicator can only animate across a navigation if
 * the node it lives on survives that navigation; while each page rendered its own
 * AppShell, the pill appeared at its destination instead of travelling there.
 *
 * This layout does NOT gate the pages under it. Next renders a layout and its page
 * together, and a client-side navigation can fetch a page's RSC payload on its own,
 * so a layout is never a security boundary. Every page below does its own check.
 * This one's check is here so the nav is not rendered for someone who cannot see the
 * workspace.
 */
export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: ReactNode
}) {
  const { id } = await params

  const user = await getCurrentUser()
  // No redirect here, on purpose. Only the page knows the full path, so only the
  // page can build an accurate `?next=`, and it redirects for exactly this case —
  // which makes this branch unreachable in a real response. Racing the page with a
  // second, less accurate redirect would land a signed-out visitor on the workspace
  // overview after signing in rather than on the document they asked for.
  if (!user) return <>{children}</>

  let context
  try {
    context = await loadWorkspaceContext(id, user.id)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  return (
    <AppShell
      user={user}
      workspace={{ id, name: context.name }}
      // Mapped, not passed whole: AppShell is a client component and NavDocument
      // carries no createdAt. Every prop crossing that boundary stays a plain string.
      documents={context.documents.map(({ id: documentId, title, type }) => ({
        id: documentId,
        title,
        type,
      }))}
      members={context.members}
      canManage={context.role === 'owner'}
      role={context.role}
    >
      {children}
    </AppShell>
  )
}
