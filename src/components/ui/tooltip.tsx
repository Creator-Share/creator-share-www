import { Tooltip as ChakraTooltip, Portal } from "@chakra-ui/react"
import * as React from "react"

export interface TooltipProps extends ChakraTooltip.RootProps {
  showArrow?: boolean
  portalled?: boolean
  portalRef?: React.RefObject<HTMLElement>
  content: React.ReactNode
  contentProps?: ChakraTooltip.ContentProps
  disabled?: boolean
}

/**
 * App-wide tooltip defaults. Picked to feel friendly rather than the
 * stock thin slate pill: brand-aligned dark blue, generous padding,
 * the same body-text font as the rest of the UI, and a soft drop
 * shadow. Callers can still override anything via `contentProps`.
 */
const DEFAULT_CONTENT_PROPS: ChakraTooltip.ContentProps = {
  bg: "#0f2440",
  color: "white",
  px: 4,
  py: 2.5,
  borderRadius: "xl",
  fontSize: "sm",
  fontWeight: "medium",
  lineHeight: "1.4",
  maxW: "280px",
  textAlign: "center",
  boxShadow:
    "0 12px 32px -8px rgba(15, 36, 64, 0.35), 0 4px 12px -2px rgba(15, 36, 64, 0.18)",
}

const DEFAULT_OPEN_DELAY = 200
const DEFAULT_CLOSE_DELAY = 100

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  function Tooltip(props, ref) {
    const {
      showArrow,
      children,
      disabled,
      portalled,
      content,
      contentProps,
      portalRef,
      openDelay = DEFAULT_OPEN_DELAY,
      closeDelay = DEFAULT_CLOSE_DELAY,
      ...rest
    } = props

    if (disabled) return children

    const mergedContentProps: ChakraTooltip.ContentProps = {
      ...DEFAULT_CONTENT_PROPS,
      ...contentProps,
    }
    const arrowBg =
      (mergedContentProps.bg as string | undefined) ?? DEFAULT_CONTENT_PROPS.bg

    return (
      <ChakraTooltip.Root
        openDelay={openDelay}
        closeDelay={closeDelay}
        {...rest}
      >
        <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
        <Portal disabled={!portalled} container={portalRef}>
          <ChakraTooltip.Positioner>
            <ChakraTooltip.Content ref={ref} {...mergedContentProps}>
              {showArrow && (
                <ChakraTooltip.Arrow
                  css={{ "--arrow-background": arrowBg }}
                >
                  <ChakraTooltip.ArrowTip />
                </ChakraTooltip.Arrow>
              )}
              {content}
            </ChakraTooltip.Content>
          </ChakraTooltip.Positioner>
        </Portal>
      </ChakraTooltip.Root>
    )
  },
)
