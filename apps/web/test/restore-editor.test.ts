import * as Y from 'yjs'
import { describe, it, expect } from 'vitest'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getEditorSchema } from '../src/components/editor-schema.js'
import { EDITOR_FRAGMENT } from '../src/components/editor-fragment.js'
import { restoreEditor } from '../src/lib/restore-editor.js'

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc()
  prosemirrorJSONToYXmlFragment(
    getEditorSchema(),
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    doc.getXmlFragment(EDITOR_FRAGMENT),
  )
  return doc
}

function jsonOf(doc: Y.Doc): unknown {
  return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(EDITOR_FRAGMENT), getEditorSchema())
}

function textOf(doc: Y.Doc): string {
  return JSON.stringify(jsonOf(doc))
}

describe('restoreEditor', () => {
  it('brings the past text back', () => {
    const past = docWith('the original')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))

    // Edit the live document away from the past state.
    const fragment = live.getXmlFragment(EDITOR_FRAGMENT)
    prosemirrorJSONToYXmlFragment(
      getEditorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rewritten' }] }] },
      fragment,
    )
    expect(textOf(live)).toContain('rewritten')

    restoreEditor(live, past)

    expect(textOf(live)).toContain('the original')
    expect(textOf(live)).not.toContain('rewritten')
  })

  it('is one transaction, so it is one update on the wire', () => {
    const past = docWith('before')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))
    prosemirrorJSONToYXmlFragment(
      getEditorSchema(),
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] },
      live.getXmlFragment(EDITOR_FRAGMENT),
    )

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreEditor(live, past)
    expect(updates).toBe(1)
  })

  it('restoring to the current state writes nothing', () => {
    const past = docWith('unchanged')
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(past))

    let updates = 0
    live.on('update', () => (updates += 1))
    restoreEditor(live, past)
    // A diff, not a rewrite. A restore to where you already are is a no-op, and a
    // version-history panel will call it exactly that way when someone clicks the
    // newest version.
    expect(updates).toBe(0)
  })

  it('round-trips every mark and node the toolbar can produce', () => {
    const schema = getEditorSchema()
    // Built from the schema, not assumed: textStyle carries color only today, and
    // fontFamily/fontSize come back (as curated ids) with a later plan.
    const textStyleAttrs: Record<string, unknown> = {}
    const sample: Record<string, unknown> = { color: '#d92d20', fontFamily: 'serif', fontSize: 21 }
    for (const key of Object.keys(schema.marks.textStyle!.spec.attrs ?? {})) {
      textStyleAttrs[key] = sample[key] ?? 'x'
    }
    expect(textStyleAttrs.color).toBe('#d92d20')

    const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({
      type,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })
    const content = [
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
          { type: 'text', text: 'strike', marks: [{ type: 'strike' }] },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'text', text: 'styled', marks: [{ type: 'textStyle', attrs: textStyleAttrs }] },
          { type: 'text', text: 'lit', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'Heading' }],
      },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'H1'), cell('tableHeader', 'H2')] },
          { type: 'tableRow', content: [cell('tableCell', 'a'), cell('tableCell', 'b')] },
        ],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
      { type: 'horizontalRule' },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
      },
    ]

    const past = new Y.Doc()
    prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content }, past.getXmlFragment(EDITOR_FRAGMENT))

    // Guard against the test passing vacuously: the past document itself must read
    // back with the marks and nodes in it, or a missing extension would make both
    // sides equally empty.
    const pastText = JSON.stringify(jsonOf(past))
    for (const needle of [
      '"bold"', '"italic"', '"underline"', '"strike"', '"code"', '"link"', '"textStyle"',
      '"highlight"', '"heading"', '"table"', '"tableHeader"', '"tableCell"', '"codeBlock"',
      '"horizontalRule"', '"center"', '#d92d20', '#fef08a',
    ]) {
      expect(pastText, needle).toContain(needle)
    }

    const live = new Y.Doc()
    restoreEditor(live, past)
    expect(jsonOf(live)).toEqual(jsonOf(past))
  })
})
