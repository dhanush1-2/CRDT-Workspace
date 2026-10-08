/**
 * Renames a document. True when the server saved it. False for a refusal and also for a
 * request that never got an answer (offline, connection reset): fetch rejects in that
 * case, and the caller only needs to know the name was not saved.
 */
export async function renameDocument(documentId: string, title: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    return response.ok
  } catch {
    return false
  }
}
