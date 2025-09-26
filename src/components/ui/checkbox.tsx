import { Checkbox as ChakraCheckbox } from "@chakra-ui/react"
import * as React from "react"

export interface CheckboxProps
  extends Omit<ChakraCheckbox.RootProps, "onCheckedChange"> {
  icon?: React.ReactNode
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
  rootRef?: React.Ref<HTMLLabelElement>
  onCheckedChange?: (checked: boolean) => void
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(props, ref) {
    const { icon, children, inputProps, rootRef, onCheckedChange, ...rest } =
      props
    return (
      <ChakraCheckbox.Root ref={rootRef} {...rest}>
        <ChakraCheckbox.HiddenInput
          ref={ref}
          {...inputProps}
          onChange={(e) => {
            onCheckedChange?.(e.target.checked)
            inputProps?.onChange?.(e)
          }}
        />
        <ChakraCheckbox.Control>
          {icon || <ChakraCheckbox.Indicator />}
        </ChakraCheckbox.Control>
        {children != null && (
          <ChakraCheckbox.Label>{children}</ChakraCheckbox.Label>
        )}
      </ChakraCheckbox.Root>
    )
  },
)
