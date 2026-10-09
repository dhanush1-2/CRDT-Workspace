import { prisma } from '@crdt/db'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'
import { stateAtVersion } from '@/lib/document-history'

// The id column is a signed 64-bit integer; anything larger cannot exist.
const MAX_ID = 9223372036854775807n

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: documentId, version } = await params
    await requireDocumentRole(user.id, documentId, 'viewer')

    // The id is a BigInt in the database and arrives as a path segment. BigInt() alone
    // is too lenient: it accepts '', ' 7 ', '0x10' and '-1'. Digits only.
    if (!/^\d+$/.test(version)) return Response.json({ error: 'invalid version' }, { status: 400 })
    const versionId = BigInt(version)
    if (versionId > MAX_ID) return Response.json({ error: 'not found' }, { status: 404 })

    // The version must be an update row of THIS document. stateAtVersion replays every
    // row with id <= versionId, so a foreign or past-the-end id would otherwise come
    // back as 200 with this document's content, a state no version ever had.
    const owned = await prisma.documentUpdate.findFirst({
      where: { id: versionId, documentId },
      select: { id: true },
    })
    if (!owned) return Response.json({ error: 'not found' }, { status: 404 })

    const state = await stateAtVersion(documentId, versionId)
    // Defensive: the row exists, so there is at least one update. Never an empty 200.
    if (!state) return Response.json({ error: 'not found' }, { status: 404 })

    return new Response(state as unknown as BodyInit, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(state.byteLength),
        // A version's bytes never change once written, but the response is
        // per-document and per-member, so it must not be shared by a proxy.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    return toResponse(error)
  }
}
