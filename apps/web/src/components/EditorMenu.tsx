'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ToolButton, keepEditorSelection } from './ToolButton'
import styles from './editor-toolbar.module.css'

/**
 * The toolbar's dropdown shell (handoff 12.5). The Style menu, the text colour menu and
 * the highlight menu are one container with three contents, so they cannot drift.
 *
 * The menus are custom, not a native <select>: the design is a glass panel with styled
 * previews and swatch grids, none of which a native popup can render.
 *
 * Where the panel sits: inside its trigger's wrapper in the row, as the design has it
 * (absolute, 40px down), not portalled out. So its items must not join the row's roving
 * set; they are plain buttons with no `data-roving`, and a ToolButton here would take
 * `roving={false}`.
 *
 * Focus. A mouse click never moves focus (every control cancels its mousedown), so the
 * editor keeps its selection and the menu is driven by pointer alone. A keyboard open
 * (Enter, Space or Down on the trigger) moves focus into the menu, and from there Esc or
 * a choice hands it back to the trigger.
 */

/** Marks the element whose bounds count as "inside the toolbar" for an outside click. */
export const MENU_SCOPE = { 'data-menu-scope': '' } as const
const SCOPE_SELECTOR = '[data-menu-scope]'
const ITEM_SELECTOR = '[data-menu-item]'
/** Swatches are laid out four to a row (handoff 12.5), so Up/Down move by four. */
const SWATCH_COLUMNS = 4

export type MenuName = 'style' | 'color' | 'highlight' | 'insert-link' | 'align'

/** What one menu is told by the group: whether it is open, and how to open and close it. */
export interface MenuControl {
  open: boolean
  /** True when it was opened from the keyboard, so focus moves into it. */
  viaKeyboard: boolean
  onOpen: (viaKeyboard: boolean) => void
  onClose: () => void
}

/**
 * One open menu at a time: opening a menu closes whichever other was open, because there
 * is one slot. Returns a function that hands each menu its own control.
 */
export function useMenuGroup(): (name: MenuName) => MenuControl {
  const [open, setOpen] = useState<{ name: MenuName; viaKeyboard: boolean } | null>(null)
  return (name) => ({
    open: open?.name === name,
    viaKeyboard: open?.name === name && open.viaKeyboard,
    onOpen: (viaKeyboard) => setOpen({ name, viaKeyboard }),
    onClose: () => setOpen((current) => (current?.name === name ? null : current)),
  })
}

const MenuContext = createContext<{ afterChoose: () => void } | null>(null)

interface EditorMenuProps {
  name: MenuName
  control: MenuControl
  /**
   * `list` is the Style menu (a listbox); `swatches` is a colour menu (a grid); `popover`
   * is a small form (the Link popover, handoff 12.6), whose own controls are a text field
   * and buttons rather than items moved between with arrows.
   */
  variant: 'list' | 'swatches' | 'popover'
  /** The trigger's accessible name. */
  label: string
  /** The trigger's tooltip. Defaults to the label. */
  title?: string
  /** The popup's name; for swatches it is also the visible title. */
  menuLabel: string
  /** The trigger's face. */
  trigger: ReactNode
  /** The 150px field look for the trigger (the Style dropdown). */
  field?: boolean
  /** Visible text beside the trigger's icon (the Insert tab's labelled buttons). */
  text?: string
  /** Pressed state for the trigger, for a menu whose tool is also a toggle (Link). */
  active?: boolean
  /**
   * Where focus goes when the menu is dismissed with Esc, or closed from its trigger,
   * while focus is inside it. Defaults to the trigger. A popover that took focus from the
   * editor hands it back to the editor here, selection restored.
   */
  restoreTo?: () => void
  /** Extra classes for the panel, for a menu whose size differs from its variant's. */
  panelClassName?: string
  children: ReactNode
}

export function EditorMenu({
  name,
  control,
  variant,
  label,
  title,
  menuLabel,
  trigger,
  field,
  text,
  active,
  restoreTo,
  panelClassName,
  children,
}: EditorMenuProps) {
  const { open, viaKeyboard, onOpen, onClose } = control
  const ids = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The latest close, read from the document listeners below so they subscribe once per
  // open rather than on every render.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  const restoreToRef = useRef(restoreTo)
  useEffect(() => {
    restoreToRef.current = restoreTo
  })

  /** Focus goes back only if it was inside the menu; a mouse user's stays in the editor. */
  const restoreFocus = useCallback(() => {
    const focused = document.activeElement
    if (!focused || !menuRef.current?.contains(focused)) return
    if (restoreToRef.current) restoreToRef.current()
    else triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    // "Outside the toolbar", not outside the menu (handoff 12.5): a click on another
    // control in the toolbar is not a close, though it opens its own menu if it is one.
    const scope = anchorRef.current?.closest(SCOPE_SELECTOR) ?? anchorRef.current
    const onMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !scope?.contains(event.target)) closeRef.current()
    }
    // On the document, not the menu: after a mouse open the focus is still in the editor,
    // so that is where an Esc keypress lands.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      restoreFocus()
      closeRef.current()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, restoreFocus])

  const focusFirst = useCallback(() => {
    const menu = menuRef.current
    if (!menu) return
    // The chosen item, so the menu opens where the current value is.
    const target =
      menu.querySelector<HTMLElement>(`${ITEM_SELECTOR}[aria-selected="true"]`) ??
      menu.querySelector<HTMLElement>(ITEM_SELECTOR)
    target?.focus()
  }, [])

  useEffect(() => {
    if (open && viaKeyboard) focusFirst()
  }, [open, viaKeyboard, focusFirst])

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    if (open) focusFirst()
    else onOpen(true)
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    // A popover's controls are a text field and buttons: Tab walks them, and the arrows,
    // Home and End belong to the field. Esc and click-away close it (above).
    if (variant === 'popover') return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Tab') {
      // Leaving the menu closes it. Focus goes to the trigger first, so Tab then moves on
      // from there rather than from an item that is about to unmount.
      triggerRef.current?.focus()
      onClose()
      return
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const last = items.length - 1
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (variant === 'list' && event.key === 'ArrowDown') next = index >= last ? 0 : index + 1
    else if (variant === 'list' && event.key === 'ArrowUp') next = index <= 0 ? last : index - 1
    else if (variant === 'swatches' && event.key === 'ArrowRight') next = Math.min(index + 1, last)
    else if (variant === 'swatches' && event.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    else if (variant === 'swatches' && event.key === 'ArrowDown')
      next = Math.min(index + SWATCH_COLUMNS, last)
    else if (variant === 'swatches' && event.key === 'ArrowUp')
      next = Math.max(index - SWATCH_COLUMNS, 0)
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  const menuId = `${ids}-menu`
  const titleId = `${ids}-title`

  return (
    <div className={styles.menuAnchor} ref={anchorRef}>
      <ToolButton
        ref={triggerRef}
        label={label}
        title={title}
        field={field}
        data-testid={`tb-${name}`}
        text={text}
        active={active}
        aria-haspopup={variant === 'list' ? 'listbox' : variant === 'popover' ? 'dialog' : 'grid'}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // click.detail is 0 for a keypress (Enter, Space), which is how a keyboard open is
        // told from a mouse open here.
        onClick={(event) => {
          if (!open) {
            onOpen(event.detail === 0)
            return
          }
          // Closing from the trigger with focus inside the panel (a popover's field) hands
          // it back first; with focus elsewhere this does nothing.
          restoreFocus()
          onClose()
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </ToolButton>
      {open && (
        <MenuContext.Provider
          value={{
            afterChoose: () => {
              restoreFocus()
              onClose()
            },
          }}
        >
          <div
            ref={menuRef}
            id={menuId}
            className={`${styles.menu} ${
              variant === 'list'
                ? styles.menuList
                : variant === 'popover'
                  ? styles.menuPopover
                  : styles.menuSwatches
            } ${panelClassName ?? ''}`}
            data-testid={`tb-${name}-menu`}
            role={variant === 'popover' ? 'dialog' : undefined}
            aria-label={variant === 'popover' ? menuLabel : undefined}
            onKeyDown={onMenuKeyDown}
            onBlur={(event) => {
              // Tabbing out of a popover closes it. A null relatedTarget is not that (the
              // window lost focus, or the press landed on nothing), so it is left to the
              // click-away listener.
              if (variant !== 'popover') return
              const next = event.relatedTarget
              if (next instanceof Node && !anchorRef.current?.contains(next)) onClose()
            }}
          >
            {variant === 'popover' && children}
            {variant === 'swatches' && (
              <div className={styles.menuTitle} id={titleId}>
                {menuLabel}
              </div>
            )}
            {variant !== 'popover' && (
              <div
                role={variant === 'list' ? 'listbox' : 'grid'}
                aria-label={variant === 'list' ? menuLabel : undefined}
                aria-labelledby={variant === 'swatches' ? titleId : undefined}
                className={variant === 'list' ? styles.menuListBody : styles.menuGrid}
              >
                {children}
              </div>
            )}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  )
}

interface MenuItemProps {
  /** `option` in the Style listbox, `gridcell` for a swatch. */
  role: 'option' | 'gridcell'
  selected: boolean
  /** The accessible name. The visible text of a row also carries its shortcut. */
  label: string
  title?: string
  className?: string
  style?: CSSProperties
  shortcut?: string
  /** Runs the choice. The menu then closes and returns focus, which is not this's job. */
  onChoose: () => void
  'data-testid'?: string
  children?: ReactNode
}

/**
 * One choice in a menu. A plain button, not a ToolButton: it is not a tool, and it must
 * not carry `data-roving`. It cancels the mousedown like every other control, which is
 * what lets a click apply its command to the editor's selection and not to nothing.
 */
export function MenuItem({
  role,
  selected,
  label,
  title,
  className,
  style,
  shortcut,
  onChoose,
  children,
  ...rest
}: MenuItemProps) {
  const menu = useContext(MenuContext)
  return (
    <button
      type="button"
      role={role}
      aria-selected={selected}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={title ?? label}
      // Reached by arrow keys, never by Tab: the menu is one stop, opened from its trigger.
      tabIndex={-1}
      data-menu-item=""
      data-testid={rest['data-testid']}
      className={className}
      style={style}
      onMouseDown={keepEditorSelection}
      onClick={() => {
        onChoose()
        menu?.afterChoose()
      }}
    >
      {children}
    </button>
  )
}
