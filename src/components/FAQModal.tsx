"use client"
import React, { useCallback } from "react"
import { Accordion, Box, Text } from "@chakra-ui/react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogTitle,
} from "@/components/ui/dialog"

interface FAQItem {
  question: string
  answer: React.ReactNode
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question:
      "How long does it take after I sponsor for a child to receive aid?",
    answer:
      "As some schools here in Tanzania will only allow children to start school during enrollment months, your sponsored child may not be eligible to start school immediately. January, August, and September are typical enrollment months, so your child may need to wait for one of those windows. Nevertheless, we do all we can to convince schools to admit children from high-risk home lives outside of enrollment windows, and often with great success. If the child must wait, our social workers and outreach team will be actively present in your child's life, ensuring they are safe and well until they are eligible to begin school full-time.",
  },
  {
    question:
      "How frequently will I receive updates from the child and their family?",
    answer:
      "For children not in our direct care, you will receive updates on your child a minimum of three times per year. This may increase depending on the child's location, as some children are several hours off-road, which makes more frequent visits impractical. For children in our care, you will receive a monthly update.",
  },
  {
    question:
      "Does all of my sponsorship go directly to resources for the child I am sponsoring?",
    answer:
      "Not all of your sponsorship goes directly to the child. This is because we must employ social workers and outreach workers, and fuel vehicles to reach children in remote areas. A detailed breakdown of the finances reaching your child will be available once the fund has been operational for six months, and we expect this to be ready by June 2026. This is a new project, and we truly hope you appreciate that your support at this early stage is literally foundational in assisting children in crisis.",
  },
  {
    question: "What if I don't want to choose a particular child?",
    answer: (
      <>
        We can choose one for you, or you might be better suited to our family
        partnership program.{" "}
        <a
          href="https://tanzania.creatorshare.com/partnership"
          target="_blank"
          className="text-[#1C3C8C] hover:underline font-medium"
        >
          Tanzania.CreatorShare.com/partnership
        </a>
      </>
    ),
  },
  {
    question:
      "What if I want to sponsor a special needs child who is already receiving full time care?",
    answer:
      "Funds are placed into a pool, which covers the costs of the entire family, homes and villages that are raising the child or children you are supporting.",
  },
]

interface FAQModalProps {
  open: boolean
  onClose: () => void
}

export const FAQModal: React.FC<FAQModalProps> = ({ open, onClose }) => {
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      )
    }
    onClose()
  }, [onClose])

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && handleClose()}
      size="xl"
      scrollBehavior="outside"
    >
      <DialogContent
        className="max-w-4xl mx-4 rounded-3xl overflow-hidden"
        style={{
          boxShadow:
            "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)",
          borderRadius: "24px",
        }}
      >
        <DialogHeader className="bg-[#1C3C8C] text-white px-10 py-6">
          <DialogTitle fontSize="xl" fontWeight="bold">
            Frequently Asked Questions
          </DialogTitle>
          <DialogCloseTrigger className="text-white hover:bg-white/20" />
        </DialogHeader>

        <DialogBody className="p-6 md:p-10">
          <Accordion.Root defaultValue={[]} className="space-y-3">
            {FAQ_ITEMS.map((item, index) => (
              <Accordion.Item
                key={index}
                value={String(index)}
                className="border border-gray-200 rounded-xl overflow-hidden"
              >
                <Accordion.ItemTrigger className="w-full text-left px-6 py-5 bg-gray-50 hover:bg-gray-100 transition-colors flex justify-between items-start gap-4 cursor-pointer">
                  <Text
                    fontWeight="semibold"
                    color="gray.800"
                    fontSize="sm"
                    lineHeight="1.5"
                  >
                    {item.question}
                  </Text>
                  <Accordion.ItemIndicator className="text-[#1C3C8C] flex-shrink-0 mt-0.5" />
                </Accordion.ItemTrigger>
                <Accordion.ItemContent>
                  <Box className="px-6 py-5 border-t border-gray-100">
                    <Text color="gray.700" fontSize="sm" lineHeight="1.8">
                      {item.answer}
                    </Text>
                  </Box>
                </Accordion.ItemContent>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}
