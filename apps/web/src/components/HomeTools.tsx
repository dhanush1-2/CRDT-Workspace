import type { ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { ToolButton, ToolSeparator } from './ToolButton'
import { useMenuGroup } from './EditorMenu'
import {
  AlignMenu,
  ColourMenu,
  HighlightMenu,
  StyleMenu,
  readBlockStyle,
  type Alignment,
  type BlockReading,
  type LastColours,
} from './HomeMenus'
import styles from './editor-toolbar.module.css'

/** What the Home row shows of the selection. Every field is a flag the bar renders. */
interface HomeFormat {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  bulletList: boolean
  orderedList: boolean
  align: Alignment
  block: BlockReading
  /** The colour and the highlight at the selection; null when it has none. */
  textColour: string | null
  highlightColour: string | null
}

function readFormat(editor: Editor): HomeFormat {
  // The block holding the start of the selection. An unaligned block has no textAlign
  // attribute (editor-schema keeps defaultAlignment null), and that is left-aligned.
  const align = editor.state.selection.$from.parent.attrs.textAlign as Alignment | null | undefined
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    align: align ?? 'left',
    block: readBlockStyle(editor),
    textColour: (editor.getAttributes('textStyle').color as string | undefined) ?? null,
    highlightColour: editor.isActive('highlight')
      ? ((editor.getAttributes('highlight').color as string | undefined) ?? null)
      : null,
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

/**
 * The Home tab's controls (handoff 12.2): history, the Style dropdown, the four inline
 * marks, the colour group, lists, the alignment dropdown and clear formatting. The four
 * menus are built on one shell (EditorMenu) and live in HomeMenus.
 *
 * The active states are re-read after every transaction, which covers both a command
 * and a caret move: `useEditorState` re-runs the selector on each one and re-renders
 * only when the flags it returns differ.
 */
export function HomeTools({ editor, lastColours }: { editor: Editor; lastColours: LastColours }) {
  const format = useEditorState({ editor, selector: ({ editor: current }) => readFormat(current) })
  // One open menu at a time across the four.
  const menu = useMenuGroup()

  // No .focus() in the chain. The click never took focus from the editor (ToolButton
  // cancels the mousedown), so there is nothing to give back, and a keyboard user who
  // pressed a button with Enter stays on it, which is how a toolbar is meant to behave.
  const run = () => editor.chain()

  return (
    <>
      <ToolButton
        label="Undo"
        title="Undo (⌘Z)"
        data-testid="tb-undo"
        // The collaborative history (y-prosemirror's undo manager, not StarterKit's).
        onClick={() => run().undo().run()}
      >
        <Icon>
          <path d="M6 4 3 7l3 3" />
          <path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H8" />
        </Icon>
      </ToolButton>
      <ToolButton
        label="Redo"
        title="Redo (⌘⇧Z)"
        data-testid="tb-redo"
        onClick={() => run().redo().run()}
      >
        <Icon>
          <path d="m10 4 3 3-3 3" />
          <path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H8" />
        </Icon>
      </ToolButton>
      <ToolSeparator />

      <StyleMenu editor={editor} control={menu('style')} current={format.block} />
      <ToolSeparator />

      <ToolButton
        label="Bold"
        title="Bold (⌘B)"
        active={format.bold}
        data-testid="tb-bold"
        onClick={() => run().toggleBold().run()}
      >
        <span className={styles.glyphBold}>B</span>
      </ToolButton>
      <ToolButton
        label="Italic"
        title="Italic (⌘I)"
        active={format.italic}
        data-testid="tb-italic"
        onClick={() => run().toggleItalic().run()}
      >
        <span className={styles.glyphItalic}>I</span>
      </ToolButton>
      <ToolButton
        label="Underline"
        title="Underline (⌘U)"
        active={format.underline}
        data-testid="tb-underline"
        onClick={() => run().toggleUnderline().run()}
      >
        <span className={styles.glyphUnderline}>U</span>
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={format.strike}
        data-testid="tb-strike"
        onClick={() => run().toggleStrike().run()}
      >
        <span className={styles.glyphStrike}>S</span>
      </ToolButton>
      <ToolSeparator />

      <ColourMenu
        editor={editor}
        control={menu('color')}
        current={format.textColour}
        last={lastColours}
      />
      <HighlightMenu
        editor={editor}
        control={menu('highlight')}
        current={format.highlightColour}
        last={lastColours}
      />
      <ToolSeparator />

      <ToolButton
        label="Bulleted list"
        active={format.bulletList}
        data-testid="tb-bullet"
        onClick={() => run().toggleBulletList().run()}
      >
        <Icon>
          <circle cx="3" cy="4" r="1.1" className={styles.iconFill} />
          <circle cx="3" cy="8" r="1.1" className={styles.iconFill} />
          <circle cx="3" cy="12" r="1.1" className={styles.iconFill} />
          <path d="M6 4h8M6 8h8M6 12h8" />
        </Icon>
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={format.orderedList}
        data-testid="tb-ordered"
        onClick={() => run().toggleOrderedList().run()}
      >
        <Icon>
          <text x="1" y="5.8" className={styles.iconNumeral}>
            1
          </text>
          <text x="1" y="9.8" className={styles.iconNumeral}>
            2
          </text>
          <text x="1" y="13.8" className={styles.iconNumeral}>
            3
          </text>
          <path d="M6 4h8M6 8h8M6 12h8" />
        </Icon>
      </ToolButton>
      <ToolSeparator />

      <AlignMenu editor={editor} control={menu('align')} current={format.align} />
      <ToolSeparator />

      <ToolButton
        label="Clear formatting"
        data-testid="tb-clear"
        // Marks off, then the block back to a plain paragraph. clearNodes also lifts
        // out of lists and quotes and, building a fresh paragraph, drops its alignment.
        onClick={() => run().clearNodes().unsetAllMarks().run()}
      >
        <Icon>
          <path d="M3 3.5h8M7 3.5v9" />
          <path d="m10 9.5 3.5 3.5M13.5 9.5 10 13" />
        </Icon>
      </ToolButton>
    </>
  )
}
