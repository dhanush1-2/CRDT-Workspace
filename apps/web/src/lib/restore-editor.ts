import type * as Y from 'yjs'
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { EDITOR_FRAGMENT } from '@/components/editor-fragment'
import { getEditorSchema } from '@/components/editor-schema'

/**
 * Write `from`'s text into `live` as ordinary edits.
 *
 * `updateYFragment` is y-prosemirror's own diff: it walks the live fragment against
 * a ProseMirror node and writes the minimum set of operations that makes them match.
 * That is what makes a restore merge sensibly with someone else's in-flight typing
 * rather than replacing the paragraph they are in.
 *
 * It needs the ProseMirror schema, which only the client has, which is why restore
 * is a client operation and not an API route. The update it produces leaves through
 * the normal socket, so it is attributed to whoever restored, and the sync server's
 * per-frame role check rejects it from a viewer without any extra enforcement.
 *
 * It does not promise an exact revert. If someone is typing when this lands, both
 * apply, and the result is the restored version plus their edit. The UI has to say
 * so; see Decision 2 in the design.
 */
export function restoreEditor(live: Y.Doc, from: Y.Doc): void {
  const schema = getEditorSchema()
  const target = live.getXmlFragment(EDITOR_FRAGMENT)
  const past = yXmlFragmentToProseMirrorRootNode(from.getXmlFragment(EDITOR_FRAGMENT), schema)

  live.transact(() => {
    // Fresh binding metadata. updateYFragment's fourth argument is a BindingMetadata
    // ({ mapping, isOMark }) on this version of @tiptap/y-tiptap, not a bare Map —
    // verified against dist/src/plugins/sync-plugin.d.ts. Both start empty because
    // this is a one-shot update with no editor binding to keep in step; handing it a
    // live binding's metadata would corrupt that binding's position cache.
    updateYFragment(live, target, past, { mapping: new Map(), isOMark: new Map() })
  })
}
