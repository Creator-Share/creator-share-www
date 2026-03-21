import type { ButtonProps } from "@chakra-ui/react"
import { IconButton as ChakraIconButton } from "@chakra-ui/react"
import * as React from "react"
import { LuX } from "react-icons/lu"

export type CloseButtonProps = ButtonProps

export const CloseButton = React.forwardRef<
  HTMLButtonElement,
  CloseButtonProps
>(function CloseButton({ children, ...props }, ref) {
  return (
    <ChakraIconButton
      variant="ghost"
      aria-label="Close"
      ref={ref}
      borderRadius="full"
      lineHeight={0}
      {...props}
    >
      {children ?? <LuX style={{ display: "block" }} />}
    </ChakraIconButton>
  )
})
