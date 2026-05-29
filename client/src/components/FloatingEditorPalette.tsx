import React from 'react'
import { Button } from '@/components/ui/button'
import { FORMATTING_ACTIONS } from '@/utils/format'

interface FloatingEditorPaletteProps {
  onWrap: (before: string, after:string) => void
  onUnwrap: (before: string, after: string) => void
  onAddTableRow?: () => void
  isInTable?: boolean
  top: number
  left: number
  activeFormats: string[]
}

const MORE_OPTIONS = FORMATTING_ACTIONS.filter(
  action => !['B', 'I', 'U', '</>', 'lnk', 'sqrt'].includes(action.label)
)

const MAIN_ACTIONS = FORMATTING_ACTIONS.filter(
  action => ['B', 'I', 'U', '</>', 'lnk', 'sqrt'].includes(action.label)
)

const PALETTE_WIDTH_PX = 280 // Approximate width, adjust as needed

export const FloatingEditorPalette: React.FC<FloatingEditorPaletteProps> = ({ onWrap, onUnwrap, onAddTableRow, isInTable, top, left, activeFormats }) => {
  const paletteRef = React.useRef<HTMLDivElement>(null)
  const [adjustedLeft, setAdjustedLeft] = React.useState(left)

  React.useEffect(() => {
    if (paletteRef.current) {
      const container = document.querySelector('.relative.min-h-0.flex-1')
      if (container) {
        const containerRect = container.getBoundingClientRect()
        const paletteRect = paletteRef.current.getBoundingClientRect()
        
        // By default, center the palette
        let newLeft = left - paletteRect.width / 2

        // Adjust if it overflows left
        if (newLeft < 0) {
          newLeft = 8
        }

        // Adjust if it overflows right
        if (newLeft + paletteRect.width > containerRect.width) {
          newLeft = containerRect.width - paletteRect.width - 8
        }
        
        setAdjustedLeft(newLeft)
      }
    }
  }, [left])
  
  // If in table but no text selected, show only the + button
  if (isInTable && onAddTableRow) {
    return (
      <div
        className="absolute z-20 flex translate-x-1/2 translate-y-2/3 items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-soft"
        style={{ top: `${top}px`, left: `${left}px` }}
      >
        <Button
          type="button"
          title="Add Table Row"
          size="icon"
          variant="ghost"
          onMouseDown={(event) => {
            event.preventDefault()
            onAddTableRow()
          }}
          className="h-8 w-8 rounded-md"
        >
          +
        </Button>
      </div>
    )
  }

  // Normal formatting toolbar for selected text
  return (
    <div
      ref={paletteRef}
      className="absolute z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1.5 shadow-soft"
      style={{ top: `${top}px`, left: `${adjustedLeft}px`, transform: 'translateY(-100%)' }}
    >
      {MAIN_ACTIONS.map((action) => {
        const isActive = activeFormats.includes(action.title!);
        return (
          <Button
            key={action.title}
            type="button"
            title={action.title}
            size="icon"
            variant={isActive ? 'secondary' : 'ghost'}
            onClick={() => (isActive ? onUnwrap(action.before, action.after) : onWrap(action.before, action.after))}
            className="h-8 w-8 rounded-md"
            style={{ fontWeight: action.label === 'B' ? 700 : 500, fontStyle: action.label === 'I' ? 'italic' : 'normal', textDecoration: action.label === 'U' ? 'underline' : 'none' }}
          >
            {action.label}
          </Button>
        )
      })}

      {isInTable && onAddTableRow && (
        <Button
          type="button"
          title="Add Table Row"
          size="icon"
          variant="ghost"
          onMouseDown={(event) => {
            event.preventDefault()
            onAddTableRow()
          }}
          className="h-8 w-8 rounded-md"
        >
          +
        </Button>
      )}

      <select
        aria-label="More LaTeX wrapping options"
        defaultValue=""
        onChange={(event) => {
          const selected = MORE_OPTIONS.find((option) => option.label === event.target.value)
          if (!selected) return

          const isActive = activeFormats.includes(selected.title!);
          if (isActive) {
            onUnwrap(selected.before, selected.after)
          } else {
            onWrap(selected.before, selected.after)
          }
          event.currentTarget.value = ''
        }}
        className="h-8 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none"
      >
        <option value="">LaTeX ▾</option>
        {MORE_OPTIONS.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
