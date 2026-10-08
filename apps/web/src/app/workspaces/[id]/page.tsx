import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { HttpError } from '@/lib/auth-guard'
import { lastActivityByDocument } from '@/lib/document-activity'
import { formatCount, formatRelativeTime } from '@/lib/format'
import { documentHref } from '@/lib/routes'
import { loadWorkspaceContext } from '@/lib/workspace-context'
import { CreateDocumentForm } from './CreateDocumentForm'
import { MembersPanel } from './MembersPanel'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // Outside any try/catch — redirect() signals by throwing.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspaces/${id}`)}`)

  let context
  try {
    context = await loadWorkspaceContext(id, user.id)
  } catch (error) {
    // requireWorkspaceRole already returns 404 rather than 403 for a workspace the
    // caller cannot see, so a non-member and a nonexistent id are indistinguishable
    // from out here — which is the point.
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  const { role, name, documents, members } = context

  const canCreate = role === 'owner' || role === 'editor'
  const now = new Date()
  const lastActivity = await lastActivityByDocument(documents.map((d) => d.id))

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>{name}</h1>
        <p className={ui.bgPill}>
          {formatCount(documents.length, 'document')} ·{' '}
          {formatCount(members.length, 'person', 'people')}
        </p>
      </div>

      <section className={styles.section} aria-labelledby="documents-heading">
        <h2 id="documents-heading">Documents</h2>
        {documents.length === 0 && !canCreate ? (
          <p className={ui.bgPill}>Nothing here yet.</p>
        ) : (
          <div className={styles.grid}>
            <div className={styles.docs} data-testid="document-list">
              {documents.map((document) => (
                <Link
                  key={document.id}
                  href={documentHref(id, document.id)}
                  className={`${ui.glass} ${ui.tile} ${styles.docTile}`}
                  data-testid={`document-${document.id}`}
                >
                  <span className={`${ui.chip} ${ui.chipAccent}`} data-testid="document-kind">
                    {document.type === 'board' ? 'Board' : 'Page'}
                  </span>
                  <span className={styles.docText}>
                    <span className={styles.docTitle}>{document.title}</span>
                    <span className={styles.docUpdated}>
                      updated {formatRelativeTime(lastActivity.get(document.id) ?? document.createdAt, now)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            {canCreate && <CreateDocumentForm workspaceId={id} />}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
        <div className={`${ui.glass} ${styles.people}`}>
          <MembersPanel members={members} canManage={role === 'owner'} />
        </div>
      </section>
    </div>
  )
}
