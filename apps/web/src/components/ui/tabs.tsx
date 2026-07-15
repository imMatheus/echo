"use client"

import type { ReactNode } from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // `relative` + `isolate` anchor the sliding indicator (an absolute child) and
  // keep it stacked below the tab labels.
  "group/tabs-list relative isolate inline-flex w-fit max-w-full items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        // Recessed "well" track, mirroring the card tray: hairline sand border
        // over a one-step-darker surface.
        default: "border border-grayscale-3 bg-grayscale-2",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// The single element that visually marks the active tab. Base UI positions it
// via --active-tab-left/-top/-width/-height; we transition those so it glides
// between tabs instead of snapping.
const tabsIndicatorVariants = cva(
  "pointer-events-none absolute top-0 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) [transform:translate(var(--active-tab-left),var(--active-tab-top))] transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none",
  {
    variants: {
      variant: {
        // A raised card sitting in the well: lighter fill, hairline border, the
        // same faint shadow the cards use (and none in dark, like the cards).
        default:
          "rounded-md border border-grayscale-3 bg-grayscale-1 shadow-card dark:border-grayscale-6 dark:bg-grayscale-5 dark:shadow-none",
        // A sliding underline pinned to the bottom edge of the active tab.
        line: "!top-auto bottom-0 !h-0.5 rounded-full bg-foreground [transform:translateX(var(--active-tab-left))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        renderBeforeHydration
        className={cn(tabsIndicatorVariants({ variant }))}
      />
      {children as ReactNode}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // `z-10` keeps the label above the sliding indicator; the active pill is
        // now the indicator, so the tab itself only changes text color.
        "relative z-10 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-grayscale-11 transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-grayscale-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:text-grayscale-12 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        // Base UI marks inactive panels inert but can leave them mounted after a
        // tab switch; force them hidden so display utilities can't reveal them.
        "flex-1 text-xs/relaxed outline-none [&[inert]]:hidden",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
