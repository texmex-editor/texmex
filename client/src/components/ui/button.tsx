import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "@/components/lib/utils"
import { buttonVariants, type ButtonVariantProps } from "./button-variants"

// React.forwardRef is load-bearing here: when Button is the `asChild` target of
// Radix primitives (DropdownMenuTrigger, TooltipTrigger, DialogTrigger,
// PopoverTrigger, etc.), Radix attaches its anchor ref to whatever child it
// receives. Without forwardRef, the ref silently fails to attach — the trigger
// still works for clicks, but Radix's Popper has no reference element to
// position against, so dropdowns/popovers/tooltips render at the initial
// pre-measure transform (translate(0, -200%)) and stay offscreen. Symptoms:
// "I can click the kebab but the menu items aren't visible." See
// https://react.dev/reference/react/forwardRef.
const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    ButtonVariantProps & {
      asChild?: boolean
    }
>(function Button(
  { className, variant = "default", size = "default", asChild = false, ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

// `buttonVariants` lives in ./button-variants so this file can only-export the
// component (Vite Fast Refresh requirement). External consumers should import
// `buttonVariants` from "@/components/ui/button-variants".
export { Button }
