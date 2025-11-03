import { Portal, Select, createListCollection, Input } from "@chakra-ui/react"
import React, { useMemo, useState } from "react"
import { Beneficiaries } from "@/types/admin.types"
const ChakraSelect: React.FC<{
  childrenList: Beneficiaries[]
  selectedChild: string[]
  setSelectedChild: (ids: string[]) => void
}> = ({ childrenList, selectedChild, setSelectedChild }) => {
  const [search, setSearch] = useState("")
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

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return collection.items
    return collection.items.filter((item) =>
      (item.label || "").toLowerCase().includes(q),
    )
  }, [collection.items, search])

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
            <div className="p-2">
              <Input
                size="sm"
                placeholder="Search child by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {filteredItems.length === 0 ? (
              <Select.Item
                item={{ label: "No children available", value: "" }}
                key=""
              >
                No children available
                <Select.ItemIndicator />
              </Select.Item>
            ) : (
              filteredItems.map((item) => (
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
