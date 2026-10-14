'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'
import { MENU_SCOPE } from './EditorMenu'
import { HomeTools } from './HomeTools'
import { InsertTools } from './InsertTools'
import { ViewTools } from './ViewTools'
import type { ViewState } from './editor-view'
import { useLastColours } from './HomeMenus'
import { keepEditorSelection } from './ToolButton'
import { useRovingToolRow } from './useRovingToolRow'
import styles from './editor-toolbar.module.css'

export type ToolbarTab = 'home' | 'insert' | 'view'

const TABS: { id: ToolbarTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'view', label: 'View' },
]

/** The design's debounce for the live count: "about 150ms". */
const WORD_COUNT_DEBOUNCE_MS = 150

/**
 * Whitespace-separated tokens. Blocks are joined with a space: doc.textContent, which
 * the design names, concatenates paragraphs with nothing between them, so "one" and
 * "two" in separate paragraphs would count as the single word "onetwo".
 */
function countWords(editor: Editor): number {
  const { doc } = editor.state
  const text = doc.textBetween(0, doc.content.size, ' ', ' ').trim()
  return text === '' ? 0 : text.split(/\s+/).length
}

function useWordCount(editor: Editor | null): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!editor) {
      setCount(0)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => setCount(countWords(editor))
    // The editor may already hold content by the time this subscribes.
    read()
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      clearTimeout(timer)
      timer = setTimeout(read, WORD_COUNT_DEBOUNCE_MS)
    }
    // 'transaction', not 'update': a peer's edit arrives as a transaction too, and the
    // count is of the shared document, not of what this person typed.
    editor.on('transaction', onTransaction)
    return () => {
      clearTimeout(timer)
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  return count
}

/**
 * Whether the sticky toolbar has left its place at the top of the sheet. At rest its top is
 * the sheet's top plus the sheet's 1px border; the gap grows past 2px only while the page
 * scrolls the sheet up under it. Read on scroll and resize, at most once a frame.
 */
function useStuck(root: RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const element = root.current
    const sheet = element?.parentElement
    if (!element || !sheet) return
    let frame = 0
    const read = () => {
      frame = 0
      setStuck(element.getBoundingClientRect().top - sheet.getBoundingClientRect().top > 2)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    // The sticky top moves 80px to 64px over 0.4s when scrolling condenses the nav, so the
    // read on that scroll sees the old top. Read again when the move ends.
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'top') schedule()
    }
    read()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    element.addEventListener('transitionend', onTransitionEnd)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      element.removeEventListener('transitionend', onTransitionEnd)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [root])
  return stuck
}

interface EditorToolbarProps {
  /** Null until Tiptap has mounted, which is after hydration. */
  editor: Editor | null
  /**
   * Whether that editor is bound to the shared document and can be written to. Home and
   * Insert render only then; View needs no editor and ignores it.
   */
  editable: boolean
  readOnly: boolean
  /** Zoom and page width. They act on the sheet, which DocumentEditor owns, not the editor. */
  view: ViewState
}

/**
 * The Word-style ribbon, sticky at the top of the page sheet (spec, "Document toolbar").
 * Row 1 holds the tabs, a "View only" chip for viewers and the word count; row 2 holds the
 * open tab's tools. It takes the floating shadow while stuck.
 */
export function EditorToolbar({ editor, editable, readOnly, view }: EditorToolbarProps) {
  const ids = useId()
  // The tab is local state; nothing outside the toolbar needs to know which is open.
  const [tab, setTab] = useState<ToolbarTab>('home')
  const tabRefs = useRef(new Map<ToolbarTab, HTMLButtonElement>())
  const words = useWordCount(editor)
  const roving = useRovingToolRow()
  const lastColours = useLastColours()
  const root = useRef<HTMLElement>(null)
  const stuck = useStuck(root)

  // A viewer cannot edit, so Home and Insert are not disabled, they are absent. Derived
  // rather than stored so a role change cannot leave the open tab pointing at one.
  const visible = readOnly ? TABS.filter((entry) => entry.id === 'view') : TABS
  const current = visible.some((entry) => entry.id === tab) ? tab : readOnly ? 'view' : 'home'

  function select(next: ToolbarTab) {
    setTab(next)
    tabRefs.current.get(next)?.focus()
  }

  // The tablist pattern: arrows move between tabs and Home/End jump, so a keyboard user
  // is one Tab stop from the whole strip rather than three.
  function onKeyDown(event: KeyboardEvent) {
    // Modified keys are the browser's (Alt+Left is Back); see useRovingToolRow.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const index = visible.findIndex((entry) => entry.id === current)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % visible.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + visible.length) % visible.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = visible.length - 1
    else return
    event.preventDefault()
    const target = visible[next]
    if (target) select(target.id)
  }

  return (
    <section
      ref={root}
      className={styles.root}
      aria-label="Document toolbar"
      data-testid="tb-root"
      data-stuck={stuck}
      // The bounds of "outside the toolbar" for a menu's click-away close.
      {...MENU_SCOPE}
    >
      <div className={styles.panel} data-testid="tb-panel">
        <div className={styles.tabsRow}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Toolbar sections"
            onKeyDown={onKeyDown}
          >
            {visible.map((entry) => (
              <button
                key={entry.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(entry.id, node)
                  else tabRefs.current.delete(entry.id)
                }}
                type="button"
                role="tab"
                id={`${ids}-tab-${entry.id}`}
                aria-selected={entry.id === current}
                // Only the open tab: the panel it names exists for that tab alone, and an
                // aria-controls pointing at an id that is not in the DOM is a broken reference.
                aria-controls={entry.id === current ? `${ids}-row-${entry.id}` : undefined}
                tabIndex={entry.id === current ? 0 : -1}
                className={`${styles.tab} ${entry.id === current ? styles.tabActive : ''}`}
                data-testid={`tb-tab-${entry.id}`}
                // Switching tabs must not take focus out of the editor either: the tool
                // the user is heading for acts on the selection they already have.
                onMouseDown={keepEditorSelection}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {readOnly && (
            <span className={styles.viewOnly} data-testid="tb-viewonly">
              View only
            </span>
          )}
          <span className={styles.wordCount} data-testid="tb-wordcount">
            {words} {words === 1 ? 'word' : 'words'}
          </span>
        </div>
        <div className={styles.divider} />
        {/* Keyed by tab so the row remounts and its entrance fade replays on a switch. */}
        <div
          key={current}
          className={styles.toolsRow}
          role="tabpanel"
          id={`${ids}-row-${current}`}
          aria-labelledby={`${ids}-tab-${current}`}
          data-testid={`tb-row-${current}`}
        >
          {/* The tools are a toolbar and say so: one Tab stop, arrows within it, which is
              the ARIA toolbar keyboard model, so the role has to match the behaviour. The
              tabpanel above only names the region the tab controls. */}
          <div
            className={styles.tools}
            role="toolbar"
            aria-label={`${visible.find((entry) => entry.id === current)?.label} tools`}
            ref={roving.ref}
            onKeyDown={roving.onKeyDown}
          >
            {/* No bound editor yet means no controls: a button that cannot act is worse than
                none, and against the unbound editor one of them throws. */}
            {current === 'home' && editor && editable && (
              <HomeTools editor={editor} lastColours={lastColours} />
            )}
            {current === 'insert' && editor && editable && <InsertTools editor={editor} />}
            {/* No editor needed: View is the viewer's whole toolbar, and it acts on the page. */}
            {current === 'view' && <ViewTools {...view} />}
          </div>
        </div>
      </div>
    </section>
  )
}
