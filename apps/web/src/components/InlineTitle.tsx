'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { renameDocument } from '@/lib/rename-document'

/**
 * A document's title as an input that reads as text. Enter or leaving the field saves;
 * Escape, an empty value or an unchanged one puts it back. A failed save puts it back
 * and says so. After a save, router.refresh() re-renders the server components, which
 * is what updates the nav's tab (owned by the workspace layout) and this page.
 *
 * Two things keep it from writing text the user never typed. Only an edit made since the
 * field was focused is saved (`dirty`): comparing the field to the live `title` is not
 * enough, because the prop can change while the field is focused and the stale text
 * would then be written back over it. And the field does not follow the prop while it
 * is being edited (`editing`), so a refresh cannot replace what is being typed.
 */
export function InlineTitle({
  documentId,
  title,
  label,
  className,
  testId,
  autoFocus = false,
  onDone,
}: {
  documentId: string
  title: string
  label: string
  className?: string
  testId: string
  autoFocus?: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  const cancelled = useRef(false)
  const dirty = useRef(false)
  // autoFocus focuses during mount, which may be before onFocus is attached.
  const editing = useRef(autoFocus)

  // A refresh brings the saved title back down; follow it, unless the field is in use.
  useEffect(() => {
    if (!editing.current) setValue(title)
  }, [title])

  async function commit() {
    if (saving) return
    const typed = dirty.current
    dirty.current = false
    editing.current = false
    if (cancelled.current) {
      cancelled.current = false
      setValue(title)
      onDone?.()
      return
    }
    const next = value.trim()
    if (!typed || next === '' || next === title) {
      setValue(title)
      onDone?.()
      return
    }
    setSaving(true)
    const saved = await renameDocument(documentId, next)
    setSaving(false)
    if (!saved) {
      setValue(title)
      toast('Could not rename. Try again.')
      onDone?.()
      return
    }
    setValue(next)
    onDone?.()
    router.refresh()
  }

  return (
    <input
      className={className}
      aria-label={label}
      value={value}
      maxLength={200}
      autoFocus={autoFocus}
      aria-busy={saving}
      data-testid={testId}
      onFocus={() => {
        editing.current = true
        dirty.current = false
      }}
      onChange={(event) => {
        dirty.current = true
        setValue(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}
