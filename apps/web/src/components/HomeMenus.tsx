'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorMenu, MenuItem, type MenuControl } from './EditorMenu'
import {
  DEFAULT_LAST_HIGHLIGHT,
  DEFAULT_LAST_TEXT,
  HIGHLIGHT_COLOURS,
  TEXT_COLOURS,
  selectedSwatch,
  type Swatch,
} from './editor-palettes'
import styles from './editor-toolbar.module.css'

// ---------------------------------------------------------------------------
// The Style menu (handoff 12.2 and 12.5)
// ---------------------------------------------------------------------------

type BlockStyleId = 'title' | 'heading' | 'subheading' | 'normal' | 'quote' | 'code'

interface BlockStyle {
  id: BlockStyleId
  name: string
  /** Each row is drawn in its own style (a class), with its shortcut at the right. */
  preview: string
  shortcut?: string
  /** The same chord in aria-keyshortcuts form. */
  keys?: string
}

// Tiptap's heading and paragraph extensions bind these chords themselves (Mod-Alt-1..3,
// Mod-Alt-0), so the menu only displays them.
const BLOCK_STYLES: readonly BlockStyle[] = [
  { id: 'title', name: 'Title', preview: styles.previewTitle ?? '', shortcut: '⌘⌥1', keys: 'Meta+Alt+1' },
  { id: 'heading', name: 'Heading', preview: styles.previewHeading ?? '', shortcut: '⌘⌥2', keys: 'Meta+Alt+2' },
  { id: 'subheading', name: 'Subheading', preview: styles.previewSubheading ?? '', shortcut: '⌘⌥3', keys: 'Meta+Alt+3' },
  { id: 'normal', name: 'Normal text', preview: styles.previewNormal ?? '', shortcut: '⌘⌥0', keys: 'Meta+Alt+0' },
  { id: 'quote', name: 'Quote', preview: styles.previewQuote ?? '' },
  { id: 'code', name: 'Code', preview: styles.previewCode ?? '' },
]

const HEADING_LEVEL: Partial<Record<BlockStyleId, 1 | 2 | 3>> = { title: 1, heading: 2, subheading: 3 }

/** What the Style trigger shows. `id` is null for a block the menu has no row for (H4 to H6). */
export interface BlockReading {
  id: BlockStyleId | null
  name: string
}

/** The block holding the selection. A quote wins over what it contains: it is the outer shape. */
export function readBlockStyle(editor: Editor): BlockReading {
  const named = (id: BlockStyleId): BlockReading => ({
    id,
    name: BLOCK_STYLES.find((style) => style.id === id)?.name ?? '',
  })
  if (editor.isActive('blockquote')) return named('quote')
  if (editor.isActive('codeBlock')) return named('code')
  for (const [id, level] of Object.entries(HEADING_LEVEL)) {
    if (editor.isActive('heading', { level })) return named(id as BlockStyleId)
  }
  const heading = editor.getAttributes('heading').level as number | undefined
  if (editor.isActive('heading') && heading) return { id: null, name: `Heading ${heading}` }
  return named('normal')
}

/**
 * Sets the block type. Quote is a wrapper and the rest are block types, so moving
 * between them takes two steps: leave the quote, then change the type. Nothing is run if
 * the block is already that style, so choosing Quote in a quote does not nest another.
 */
function applyBlockStyle(editor: Editor, id: BlockStyleId) {
  const inQuote = editor.isActive('blockquote')
  const chain = editor.chain()
  if (id === 'quote') {
    if (inQuote) return
    chain.setParagraph().setBlockquote().run()
    return
  }
  if (inQuote) chain.lift('blockquote')
  const level = HEADING_LEVEL[id]
  if (level) chain.setHeading({ level })
  else if (id === 'code') chain.setCodeBlock()
  else chain.setParagraph()
  chain.run()
}

export function StyleMenu({
  editor,
  control,
  current,
}: {
  editor: Editor
  control: MenuControl
  current: BlockReading
}) {
  return (
    <EditorMenu
      name="style"
      control={control}
      variant="list"
      field
      label={`Text style: ${current.name}`}
      title="Text style"
      menuLabel="Text style"
      trigger={
        <>
          <span className={styles.styleName} data-testid="tb-style-current">
            {current.name}
          </span>
          <span className={styles.styleCaret} aria-hidden="true">
            ▼
          </span>
        </>
      }
    >
      {BLOCK_STYLES.map((style) => (
        <MenuItem
          key={style.id}
          role="option"
          selected={current.id === style.id}
          label={style.name}
          shortcut={style.keys}
          className={styles.styleRow}
          data-testid={`tb-style-${style.id}`}
          onChoose={() => applyBlockStyle(editor, style.id)}
        >
          <span className={style.preview} data-testid={`tb-style-${style.id}-preview`}>
            {style.name}
          </span>
          <span className={styles.styleShortcut} data-testid={`tb-style-${style.id}-shortcut`}>
            {style.shortcut}
          </span>
        </MenuItem>
      ))}
    </EditorMenu>
  )
}

// ---------------------------------------------------------------------------
// Colour and highlight (handoff 12.2 and 12.5)
// ---------------------------------------------------------------------------

/** The colour last chosen from each menu, which the triggers' bars show. */
export interface LastColours {
  text: string
  highlight: string
  setText: (value: string) => void
  setHighlight: (value: string) => void
}

/**
 * Held by the toolbar, not by the Home row: the row remounts when the tab changes, and
 * the bars would otherwise fall back to their defaults on every visit to another tab.
 */
export function useLastColours(): LastColours {
  const [text, setText] = useState(DEFAULT_LAST_TEXT)
  const [highlight, setHighlight] = useState(DEFAULT_LAST_HIGHLIGHT)
  return { text, highlight, setText, setHighlight }
}

const RING_IDLE = 'inset 0 0 0 1px rgba(0, 0, 0, 0.1)'

interface SwatchMenuProps {
  name: 'color' | 'highlight'
  palette: readonly Swatch[]
  /** The swatch matching the selection, or undefined for a colour outside the palette. */
  selected: Swatch | undefined
  /** Colour of the selected swatch's ring. */
  ring: (swatch: Swatch) => string
  onChoose: (swatch: Swatch) => void
}

/** Two rows of four. A grid role wants rows, and the keyboard model moves by four. */
function SwatchGrid({ name, palette, selected, ring, onChoose }: SwatchMenuProps) {
  const rows = [palette.slice(0, 4), palette.slice(4)]
  return (
    <>
      {rows.map((row, index) => (
        <div role="row" className={styles.swatchRow} key={index}>
          {row.map((swatch) => {
            const isSelected = swatch === selected
            return (
              <MenuItem
                key={swatch.id}
                role="gridcell"
                selected={isSelected}
                label={swatch.name}
                className={`${styles.swatch} ${swatch.clears && name === 'highlight' ? styles.swatchNone : ''}`}
                style={{
                  // The clearing highlight swatch is drawn by its class: white with a red
                  // diagonal. Every other swatch is its own colour.
                  background: name === 'highlight' && swatch.clears ? undefined : swatch.value,
                  boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 4px ${ring(swatch)}` : RING_IDLE,
                }}
                data-testid={`tb-${name}-${swatch.id}`}
                onChoose={() => onChoose(swatch)}
              />
            )
          })}
        </div>
      ))}
    </>
  )
}

export function ColourMenu({
  editor,
  control,
  current,
  last,
}: {
  editor: Editor
  control: MenuControl
  /** The colour at the selection, or null when it has none. */
  current: string | null
  last: LastColours
}) {
  return (
    <EditorMenu
      name="color"
      control={control}
      variant="swatches"
      label="Text color"
      menuLabel="Text color"
      trigger={
        <span className={styles.colourGlyph}>
          <span className={styles.colourLetter}>A</span>
          <span
            className={styles.colourBar}
            style={{ background: last.text }}
            data-testid="tb-color-bar"
          />
        </span>
      }
    >
      <SwatchGrid
        name="color"
        palette={TEXT_COLOURS}
        selected={selectedSwatch(TEXT_COLOURS, current)}
        ring={(swatch) => swatch.value}
        onChoose={(swatch) => {
          const chain = editor.chain()
          if (swatch.clears) chain.unsetColor().run()
          else chain.setColor(swatch.value).run()
          last.setText(swatch.value)
        }}
      />
    </EditorMenu>
  )
}

export function HighlightMenu({
  editor,
  control,
  current,
  last,
}: {
  editor: Editor
  control: MenuControl
  /** The highlight at the selection, or null when it has none. */
  current: string | null
  last: LastColours
}) {
  return (
    <EditorMenu
      name="highlight"
      control={control}
      variant="swatches"
      label="Highlight"
      menuLabel="Highlight"
      trigger={
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m9.5 2.5 3.5 3.5-5.5 5.5H4V8z" />
          <path
            d="M2.5 14.5h11"
            className={styles.highlightBar}
            style={{ stroke: last.highlight }}
            data-testid="tb-highlight-bar"
          />
        </svg>
      }
    >
      <SwatchGrid
        name="highlight"
        palette={HIGHLIGHT_COLOURS}
        selected={selectedSwatch(HIGHLIGHT_COLOURS, current)}
        // A pale swatch's own colour would not show as a ring, so a neutral one is used.
        ring={() => 'rgba(40, 40, 60, 0.35)'}
        onChoose={(swatch) => {
          const chain = editor.chain()
          if (swatch.clears) {
            chain.unsetHighlight().run()
            // None removes a highlight; it is not a colour, so the bar keeps its last one.
            return
          }
          chain.setHighlight({ color: swatch.value }).run()
          last.setHighlight(swatch.value)
        }}
      />
    </EditorMenu>
  )
}

// ---------------------------------------------------------------------------
// Alignment (spec, "Document toolbar": the alignment controls are one dropdown)
// ---------------------------------------------------------------------------

export type Alignment = 'left' | 'center' | 'right' | 'justify'

export const ALIGNMENTS: readonly { id: Alignment; label: string; path: string }[] = [
  { id: 'left', label: 'Align left', path: 'M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8' },
  { id: 'center', label: 'Center', path: 'M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8' },
  { id: 'right', label: 'Align right', path: 'M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8' },
  { id: 'justify', label: 'Justify', path: 'M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12' },
]

/**
 * One trigger showing the current alignment, and a 170px list of the four. A listbox like
 * the Style menu: the arrows move through it, Enter chooses, Esc closes. Choosing sets the
 * alignment rather than toggling it: pressing the one already chosen must not silently
 * revert to the default.
 */
export function AlignMenu({
  editor,
  control,
  current,
}: {
  editor: Editor
  control: MenuControl
  current: Alignment
}) {
  const shown = ALIGNMENTS.find((entry) => entry.id === current) ?? ALIGNMENTS[0]!
  return (
    <EditorMenu
      name="align"
      control={control}
      variant="list"
      label={`Alignment: ${shown.label}`}
      title="Alignment"
      menuLabel="Alignment"
      panelClassName={styles.menuAlign}
      trigger={
        <>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={shown.path} />
          </svg>
          <span className={styles.alignCaret} aria-hidden="true">
            ▼
          </span>
        </>
      }
    >
      {ALIGNMENTS.map((entry) => (
        <MenuItem
          key={entry.id}
          role="option"
          selected={current === entry.id}
          label={entry.label}
          className={styles.alignRow}
          data-testid={`tb-align-${entry.id}`}
          onChoose={() => editor.chain().setTextAlign(entry.id).run()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={entry.path} />
          </svg>
          <span>{entry.label}</span>
        </MenuItem>
      ))}
    </EditorMenu>
  )
}
