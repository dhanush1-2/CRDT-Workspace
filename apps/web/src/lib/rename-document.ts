/** Renames a document. True when the server saved it. */
export async function renameDocument(documentId: string, title: string): Promise<boolean> {
  const response = await fetch(`/api/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  return response.ok
}
