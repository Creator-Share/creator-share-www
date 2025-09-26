"use client"
import { Box, Flex, Button, SimpleGrid } from "@chakra-ui/react"
import React, { useState, useEffect, useMemo } from "react"
import BeneficiaryCard from "../SponsorshipCard"
import BeneficiaryActivityModal from "../SponsorshipActivity/BeneficiaryActivityModal"
import { BeneficiaryListingsProps } from "@/types/propTypes"

const BeneficiaryListings = React.forwardRef<
  HTMLDivElement,
  BeneficiaryListingsProps
>(
  (
    {
      beneficiaryData,
      selectedBeneficiaryId,
      selectedCountry,
      setSelectedBeneficiaryId,
      mapBounds,
      beneficiaryType = "CHILD",
    },
    ref,
  ) => {
    const [currentPage, setCurrentPage] = useState(1)
    const [dialogOpen, setDialogOpen] = useState<boolean>(false)
    const isInIframe = window.self !== window.top
    const itemsPerPage = 6

    const filteredBeneficiary = React.useMemo(() => {
      const safeBeneficiaryData = Array.isArray(beneficiaryData)
        ? beneficiaryData
        : []

      const filtered = safeBeneficiaryData.filter((beneficiary) => {
        if (selectedCountry && beneficiary.country !== selectedCountry) {
          return false
        }

        if (mapBounds) {
          if (beneficiary.location_geo) {
            const [lng, lat] = beneficiary.location_geo.coordinates
            return mapBounds.contains([lat, lng])
          } else {
            return true
          }
        }

        return true
      })

      return filtered
    }, [beneficiaryData, selectedCountry, mapBounds])

    const visibleBeneficiary = React.useMemo(() => {
      const startIndex = (currentPage - 1) * itemsPerPage
      const endIndex = startIndex + itemsPerPage
      const sliced = filteredBeneficiary.slice(startIndex, endIndex)

      return sliced
    }, [filteredBeneficiary, currentPage, itemsPerPage])

    // Calculate total pages
    const totalPages = Math.ceil(filteredBeneficiary.length / itemsPerPage)

    // Generate pagination items with ellipsis
    const generatePaginationItems = () => {
      const items = []
      const maxVisiblePages = 7 // Show max 7 page numbers
      
      if (totalPages <= maxVisiblePages) {
        // Show all pages if total is small
        for (let i = 1; i <= totalPages; i++) {
          items.push(i)
        }
      } else {
        // Always show first page
        items.push(1)
        
        if (currentPage <= 4) {
          // Show first 5 pages + ellipsis + last page
          for (let i = 2; i <= 5; i++) {
            items.push(i)
          }
          items.push('ellipsis')
          items.push(totalPages)
        } else if (currentPage >= totalPages - 3) {
          // Show first page + ellipsis + last 5 pages
          items.push('ellipsis')
          for (let i = totalPages - 4; i <= totalPages; i++) {
            items.push(i)
          }
        } else {
          // Show first page + ellipsis + current-1, current, current+1 + ellipsis + last page
          items.push('ellipsis')
          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
            items.push(i)
          }
          items.push('ellipsis')
          items.push(totalPages)
        }
      }
      
      return items
    }

    const paginationItems = generatePaginationItems()

    useEffect(() => {
      if (isInIframe) {
        setTimeout(() => {
          window.parent.postMessage(
            {
              type: "resize",
              height: document.documentElement.scrollHeight + 200,
            },
            "*",
          )
        }, 100)
      }
    }, [isInIframe])

    const mapBoundsString = useMemo(() => JSON.stringify(mapBounds || {}), [mapBounds])

    useEffect(() => {
      setCurrentPage(1)
    }, [selectedCountry, mapBoundsString])

    useEffect(() => {
      if (!selectedBeneficiaryId) return

      const index = filteredBeneficiary.findIndex(
        (b) => b.id === selectedBeneficiaryId,
      )

      if (index === -1) return

      const newPage = Math.floor(index / itemsPerPage) + 1

      if (newPage !== currentPage) {
        setPageChangeFromSelection(true)
        setCurrentPage(newPage)
      }
    }, [selectedBeneficiaryId, filteredBeneficiary, currentPage, itemsPerPage])

    const [pageChangeFromSelection, setPageChangeFromSelection] = useState(false)

    useEffect(() => {
      if (selectedBeneficiaryId && !pageChangeFromSelection) {
        setSelectedBeneficiaryId(null)
      }
    }, [
      currentPage,
      pageChangeFromSelection,
      setSelectedBeneficiaryId,
      selectedBeneficiaryId,
    ])

    useEffect(() => {
      if (selectedBeneficiaryId && pageChangeFromSelection) {
        setTimeout(() => {
          const el = document.getElementById(selectedBeneficiaryId)
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" })
          }
          setPageChangeFromSelection(false)
        }, 100)
      }
    }, [selectedBeneficiaryId, pageChangeFromSelection])

    useEffect(() => {
      if (pageChangeFromSelection) {
        const timer = setTimeout(() => {
          setPageChangeFromSelection(false)
        }, 500)
        return () => clearTimeout(timer)
      }
    }, [pageChangeFromSelection])

    const handleOpenDialog = (beneficiaryId?: string) => {
      if (!beneficiaryId) return
      const index = visibleBeneficiary.findIndex(
        (beneficiary) => beneficiary.id === beneficiaryId,
      )
      if (index !== -1) {
        setCurrentDialogIndex(index)
        setDialogOpen(true)
      }
    }

    const [currentDialogIndex, setCurrentDialogIndex] = useState<number>(0)

    return (
      <Box
        ref={ref}
        width="100%"
        className="border bg-white rounded-2xl"
        px={{ base: 3, md: 8 }}
        mt={4}
        style={{ minHeight: visibleBeneficiary.length ? "auto" : "100px" }}
        suppressHydrationWarning={true}
      >
        {visibleBeneficiary.length > 0 && (
          <BeneficiaryActivityModal
            open={dialogOpen}
            onClose={(open?: boolean) => setDialogOpen(Boolean(open))}
            beneficiary={
              visibleBeneficiary[currentDialogIndex] || visibleBeneficiary[0]
            }
          />
        )}

        <Box pt={10} pb={6}>
          <SimpleGrid columns={{ base: 1, md: 3 }} gap="1.5rem">
            {visibleBeneficiary.map((beneficiary) =>
              beneficiary.id ? (
                <Box key={beneficiary.id}>
                  <BeneficiaryCard
                    beneficiary={beneficiary}
                    isSelected={selectedBeneficiaryId === beneficiary.id}
                    id={beneficiary.id}
                    onOpenDialog={() => handleOpenDialog(beneficiary.id)}
                    beneficiaryType={beneficiaryType}
                  />
                </Box>
              ) : null,
            )}
          </SimpleGrid>
        </Box>

        {filteredBeneficiary.length > itemsPerPage && (
          <Flex justify="center" pb={10} gap={2} flexWrap="wrap">
            <Flex gap={1} align="center">
              <Button
                onClick={() => {
                  setSelectedBeneficiaryId(null)
                  setCurrentPage((prev) => Math.max(1, prev - 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage === 1}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              
              {paginationItems.map((item, index) => (
                <React.Fragment key={index}>
                  {item === 'ellipsis' ? (
                    <Box px={2} py={1} color="gray.500">
                      ...
                    </Box>
                  ) : (
                    <Button
                      onClick={() => {
                        setSelectedBeneficiaryId(null)
                        setCurrentPage(item as number)
                        window.scrollTo({ top: 0, behavior: "smooth" })
                      }}
                      colorScheme={currentPage === item ? "blue" : undefined}
                      variant={currentPage === item ? "solid" : "outline"}
                      size="sm"
                      aria-current={currentPage === item ? "page" : undefined}
                      fontWeight={currentPage === item ? "bold" : "normal"}
                    >
                      {item}
                    </Button>
                  )}
                </React.Fragment>
              ))}
              
              <Button
                onClick={() => {
                  setSelectedBeneficiaryId(null)
                  setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage === totalPages}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </Flex>
          </Flex>
        )}
      </Box>
    )
  },
)

BeneficiaryListings.displayName = "BeneficiaryListings"

export default BeneficiaryListings
