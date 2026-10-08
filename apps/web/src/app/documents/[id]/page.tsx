import { notFound, redirect } from 'next/navigation'
import { HttpError, requireDocumentRole } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { documentHref } from '@/lib/routes'

/**
 * The old flat document URL.
 *
 * Documents live under their workspace now, but this path is in bookmarks, in links
 * people have shared, and in `?next=` values already minted into sign-in URLs. It
 * resolves the workspace and forwards.
 *
 * The role check runs before the redirect because the canonical URL contains the
 * workspace id: redirecting first would hand that id to anyone holding a document id,
 * including people with no access to either.
 */
export default async function LegacyDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // The legacy path, not the canonical one: nothing has been looked up yet, so there
  // is no workspace id to put in the URL. After signing in the user lands back here
  // and is forwarded from a request that can resolve it.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/documents/${id}`)}`)

  let workspaceId: string
  try {
    ;({ workspaceId } = await requireDocumentRole(user.id, id, 'viewer'))
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  redirect(documentHref(workspaceId, id))
}
