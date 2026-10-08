import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'

// Same bound as creating a document (POST /api/workspaces/[id]/documents), applied
// after trimming, so "   " is empty rather than a three-character title.
const Body = z.object({ title: z.string().trim().min(1).max(200) })

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id } = await params
    // Editors and owners. A viewer gets 403; a non-member or a missing id gets 404, so
    // an id alone never confirms that a document exists.
    await requireDocumentRole(user.id, id, 'editor')

    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const document = await prisma.document.update({
      where: { id },
      data: { title: parsed.data.title },
      select: { id: true, title: true },
    })
    return Response.json(document)
  } catch (error) {
    return toResponse(error)
  }
}
