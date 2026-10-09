import { z } from 'zod'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'
import { listVersions } from '@/lib/document-history'

// Capped: the client shows a panel, not an archive, and an unbounded limit is a
// free way for any member to ask for the whole log.
const Query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: documentId } = await params
    // Reading history is a read. requireDocumentRole returns 404 rather than 403 for
    // a document the caller cannot see, so a non-member cannot tell it exists.
    await requireDocumentRole(user.id, documentId, 'viewer')

    const parsed = Query.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!parsed.success) return Response.json({ error: 'invalid query' }, { status: 400 })

    const versions = await listVersions(documentId, parsed.data.limit)
    return Response.json({ versions })
  } catch (error) {
    return toResponse(error)
  }
}
