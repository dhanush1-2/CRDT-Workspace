import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import { getCurrentUser } from '@/lib/current-user'
import { AppShell } from '@/components/AppShell'
import { formatCount } from '@/lib/format'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import styles from './dashboard.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Read through the membership table rather than listing workspaces and filtering:
  // a workspace you are not a member of is never loaded in the first place, which is
  // the same rule requireWorkspaceRole enforces on every API route.
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: {
      workspace: {
        select: {
          id: true,
          name: true,
          _count: { select: { documents: true, members: true } },
        },
      },
    },
    orderBy: { workspace: { name: 'asc' } },
  })

  return (
    <AppShell
      user={user}
      workspaces={memberships.map(({ workspace }) => ({ id: workspace.id, name: workspace.name }))}
    >
      <div className={styles.page}>
        <h1>Workspaces</h1>
        <div className={styles.grid}>
          {memberships.map(({ workspace }) => (
            <Link
              key={workspace.id}
              href={`/workspaces/${workspace.id}`}
              className={`${ui.surface} ${ui.tile} ${styles.tile}`}
              data-testid={`workspace-${workspace.id}`}
            >
              <span className={styles.initial} aria-hidden="true">
                {workspace.name.slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.tileText}>
                <span className={styles.tileName}>{workspace.name}</span>
                <span className={styles.tileMeta}>
                  {formatCount(workspace._count.documents, 'document')} ·{' '}
                  {formatCount(workspace._count.members, 'person', 'people')}
                </span>
              </span>
            </Link>
          ))}
          <CreateWorkspaceForm />
        </div>
      </div>
    </AppShell>
  )
}
