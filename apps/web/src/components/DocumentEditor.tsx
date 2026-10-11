'use client'

import { useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { EditorToolbar } from './EditorToolbar'
import { EDITOR_FRAGMENT } from './editor-fragment'
import { editorExtensions } from './editor-schema'
import { ZOOM_DEFAULT, type PageWidth } from './editor-view'
import { LinkOpen } from './link-open'

interface DocumentEditorProps {
  /** Null until the session exists, which is one effect after the first render. */
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  user: { name: string; color: string }
  readOnly?: boolean
  /** The sheet's own styles. They live with the page, which owns its width and margin. */
  sheetClassName?: string
  /** The padding box under the toolbar, inside the sheet. Its styles live with the page too. */
  bodyClassName?: string
  /** The document's title, rendered at the top of the sheet. */
  heading: ReactNode
  /**
   * Fixed content, for showing a document that is not being edited (a past version).
   * Used only without a doc: with one, the Y.Doc is the content.
   */
  content?: JSONContent
  /** False hides the toolbar, which a read-only preview has nothing to put in. */
  toolbar?: boolean
}

/**
 * The document surface: the page sheet, with the toolbar sticky at its top (spec, "Document
 * toolbar": by default the bar sits inside the page sheet) and the text under it.
 *
 * This owns `useEditor` rather than a component beneath the sheet because the toolbar
 * and the text are both inside the sheet and have to read the same editor.
 * It replaced Editor.tsx, which had shrunk to a hook call and one element.
 *
 * It renders before the session exists, with a toolbar and no editor, so server HTML
 * and the first client render already have the toolbar's height. Mounting it only once
 * the session was ready made the sheet jump down by the toolbar's height on every load.
 */
export function DocumentEditor({
  doc,
  provider,
  user,
  readOnly = false,
  sheetClassName,
  bodyClassName,
  heading,
  content,
  toolbar = true,
}: DocumentEditorProps) {
  const collaborative = doc !== null && provider !== null
  // The View tab's two settings. They live here, not in the toolbar, because they change
  // the sheet and the editor's container, which are siblings of it. Not persisted: a page
  // opens at 100% and narrow, as the design's does.
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [pageWidth, setPageWidth] = useState<PageWidth>('narrow')

  const editor = useEditor(
    {
      // Next.js renders this on the server first; Tiptap must not render until hydration.
      immediatelyRender: false,
      // Not editable until it is bound: text typed into an editor with no Y.Doc behind
      // it would be thrown away when the binding arrives.
      editable: !readOnly && collaborative,
      // Never alongside Collaboration, which fills the editor from the Y.Doc itself.
      ...(collaborative ? {} : { content }),
      extensions: [
        // The document's shape lives in one place; see editor-schema.ts, which also
        // explains why StarterKit's undo is off.
        ...editorExtensions,
        // Cmd/Ctrl-click follows a link; a plain click edits it. See link-open.ts.
        LinkOpen,
        ...(collaborative
          ? [
              Collaboration.configure({ document: doc, field: EDITOR_FRAGMENT }),
              CollaborationCaret.configure({ provider, user }),
            ]
          : []),
      ],
    },
    [doc, provider, content],
  )

  return (
    // data-width, not a second class: the sheet's stylesheet owns what each width is.
    // data-toolbar lets it give the body less top padding under the toolbar (40px) than
    // without one (56px, a read-only preview), as the reference does.
    <div
      className={sheetClassName}
      data-testid="document-page"
      data-width={pageWidth}
      data-toolbar={toolbar ? 'true' : 'false'}
    >
      {toolbar && (
        <EditorToolbar
          editor={editor}
          // Home and Insert need an editor that is bound: for one effect the editor is
          // unbound, non-editable and without the Collaboration extension, so it has no
          // undo, and a click on Undo there throws. View does not depend on this.
          editable={editor?.isEditable === true}
          readOnly={readOnly}
          view={{ zoom, onZoom: setZoom, pageWidth, onPageWidth: setPageWidth }}
        />
      )}
      <div className={bodyClassName} data-testid="document-body">
        {/* CSS zoom wraps the title as well as the editor (handoff 12.4, resolved against
            the prototype: it zooms a div that contains the document's h1, so the title
            scales with the body). Zooming only `.editor` left a 32px title over 12.6px
            text at 70%. A percentage string: it is unambiguous as a CSS value.

            Verified in Chromium 153 only. The exposure is not the remote carets (inline
            widget spans, they scale with the text anywhere) but ProseMirror's own
            posAtCoords/coordsAtPos, which drive clicks, drag selection and scroll-into-view
            and which Chrome older than 128, and possibly Safari, report unzoomed. */}
        <div data-testid="document-zoom" style={{ zoom: `${zoom}%` }}>
          {heading}
          <EditorContent editor={editor} className="editor" />
        </div>
      </div>
    </div>
  )
}
