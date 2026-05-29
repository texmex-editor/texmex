import { GripVertical } from 'lucide-react'
import * as React from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { cn } from "@/components/lib/utils"

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof PanelGroup>) => (
  <PanelGroup className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)} {...props} />
)

const ResizablePanel = Panel

const ResizableHandle = ({ withHandle, className, ...props }: React.ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) => (
  <PanelResizeHandle
    className={cn(
      'relative flex w-1 items-center justify-center bg-border/70 after:absolute after:inset-y-0 after:left-1/2 after:w-[1px] after:-translate-x-1/2 after:bg-border hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-7 w-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm">
        <GripVertical className="h-3.5 w-3.5" />
      </div>
    ) : null}
  </PanelResizeHandle>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
