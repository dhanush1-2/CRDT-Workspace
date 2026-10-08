import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { HttpError, requireWorkspaceRole } from '@/lib/auth-guard'
import { colorFor } from '@/lib/color'
import { getCurrentUser } from '@/lib/current-user'
import { documentHref } from '@/lib/routes'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>
}) {
  const { id: workspaceId, docId } = await params

  const user = await getCurrentUser()
  // Outside any try/catch — redirect() signals by throwing.
  if (!user) redirect(`/login?next=${encodeURIComponent(documentHref(workspaceId, docId))}`)

  // The layout above is not a gate (see its comment); this is the access check.
  // Declared with its type: `let role` alone is implicitly `any` under strict.
  let role: Role
  try {
    role = await requireWorkspaceRole(user.id, workspaceId, 'viewer')
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  // Both ids in the where clause. A real document id paired with a workspace the
  // caller happens to own would otherwise render someone else's document under this
  // workspace's nav and tabs. Queried only after the role check, so a non-member
  // never learns whether an id exists.
  const document = await prisma.document.findFirst({
    where: { id: docId, workspaceId },
    select: { title: true, type: true },
  })
  if (!document) notFound()

  // The visible heading is rendered by DocumentClient from `title` (it sits inside the
  // zoomed wrapper with the editor; see DocumentEditor), exactly as on the old page.
  return (
    <DocumentClient
      documentId={docId}
      title={document.title}
      type={document.type}
      readOnly={role === 'viewer'}
      user={{ name: user.name, color: colorFor(user.id) }}
    />
  )
}
