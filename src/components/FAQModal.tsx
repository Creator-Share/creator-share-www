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
      "A child that is sponsored will receive near-immediate contact from the team. Then, the process of school enrollment begins. As some schools will only accept children during January and August in September or enrollment months, then the time your child actually begins school itself can differ. If your child is already enrolled in school, they will usually receive support within 2 weeks to keep them safely in school or be re-admitted. From the moment you click to share with a child, usually within 2 weeks, some form of direct support and positive impact on your sponsored child's life will commence.",
  },
  {
    question:
      "How frequently will I receive updates from the child and their family?",
    answer:
      "For children not in our care, we will update you about your child a minimum of 3 times a year... this can increase depending on the children's geographical location. Some children are hours off-road driving away, so unfortunately, it's not possible to keep physical contact open more regularly. For children in our care, you will receive a monthly update about the child or children you are supporting.",
  },
  {
    question:
      "Does all of my sponsorship go directly to resources for the child I am sponsoring?",
    answer:
      "Not all of your sponsorship goes directly to the child. That's because we must employ social workers, outreach workers and use and fuel vehicles to reach the children. An exact breakdown on the finances reaching your child will be available once the fund has been operational for 6 months, meaning by June 2026 we should have an updated comprehensive breakdown for you. It's a new project, so we hope you can understand how you coming with us on this journey of discovery at this time is literally foundational in assisting children in crisis.",
  },
  {
    question: "What if I don't want to chose a particular child?",
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
