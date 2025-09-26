import { Portal, Select, createListCollection } from "@chakra-ui/react"
import React, { useMemo } from "react"
import { Beneficiaries } from "@/types/admin.types"
const ChakraSelect: React.FC<{
  childrenList: Beneficiaries[]
  selectedChild: string[]
  setSelectedChild: (ids: string[]) => void
}> = ({ childrenList, selectedChild, setSelectedChild }) => {
  const collection = useMemo(
    () =>
      createListCollection({
        items: childrenList.map((child) => ({
          label: child.name,
          value: child.id,
        })),
      }),
    [childrenList],
  )

  return (
    <Select.Root
      collection={collection}
      value={selectedChild}
      onValueChange={(details) => {
        setSelectedChild(
          Array.isArray(details.value) ? details.value : [details.value],
        )
      }}
      size="sm"
      width="320px"
    >
      <Select.HiddenSelect />
      <Select.Label>Select child</Select.Label>
      <Select.Control>
        <Select.Trigger className="border border-stone-600 p-2 w-full">
          <Select.ValueText placeholder="-- Select --" />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content>
            {collection.items.length === 0 ? (
              <Select.Item
                item={{ label: "No children available", value: "" }}
                key=""
              >
                No children available
                <Select.ItemIndicator />
              </Select.Item>
            ) : (
              collection.items.map((item) => (
                <Select.Item item={item} key={item.value}>
                  {item.label}
                  <Select.ItemIndicator />
                </Select.Item>
              ))
            )}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  )
}

export default ChakraSelect
