import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react"
import { RxCross2 } from "react-icons/rx"
import * as React from "react"

interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean
  portalRef?: React.RefObject<HTMLElement>
  offset?: ChakraDrawer.ContentProps["padding"]
}

export const DrawerContent = React.forwardRef<
  HTMLDivElement,
  DrawerContentProps
>(function DrawerContent(props, ref) {
  const { children, portalled = true, portalRef, offset, ...rest } = props
  return (
    <Portal disabled={!portalled} container={portalRef}>
      <ChakraDrawer.Positioner padding={offset}>
        <ChakraDrawer.Content ref={ref} {...rest} asChild={false}>
          {children}
        </ChakraDrawer.Content>
      </ChakraDrawer.Positioner>
    </Portal>
  )
})

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  const { children, ...rest } = props
  return (
    <ChakraDrawer.CloseTrigger
      position="absolute"
      top="50%"
      insetEnd="2"
      transform="translateY(-50%)"
      {...rest}
      asChild
    >
      <button
        ref={ref}
        aria-label="Close"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
          color: "inherit",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.15)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "transparent")
        }
      >
        {children ?? <RxCross2 size={24} style={{ display: "block" }} />}
      </button>
    </ChakraDrawer.CloseTrigger>
  )
})

export const DrawerTrigger = ChakraDrawer.Trigger
export const DrawerRoot = ChakraDrawer.Root
export const DrawerFooter = ChakraDrawer.Footer

export const DrawerHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof ChakraDrawer.Header>
>(function DrawerHeader({ position = "relative", ...props }, ref) {
  return <ChakraDrawer.Header ref={ref} position={position} {...props} />
})
export const DrawerBody = ChakraDrawer.Body
export const DrawerBackdrop = ChakraDrawer.Backdrop
export const DrawerDescription = ChakraDrawer.Description
export const DrawerTitle = ChakraDrawer.Title
export const DrawerActionTrigger = ChakraDrawer.ActionTrigger
