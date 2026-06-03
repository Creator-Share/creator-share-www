"use client"

import React, { Component, type ReactNode } from "react"
import { Box, Heading, Text, Button } from "@chakra-ui/react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box className="container mx-auto py-20 text-center" maxW="1200px" px={4}>
          <Text fontSize="4xl" mb={4}>💔</Text>
          <Heading size="lg" mb={2}>Something went wrong</Heading>
          <Text color="gray.500" mb={6} maxW="480px" mx="auto" lineHeight="1.6">
            We couldn&apos;t load your dashboard right now. Please try refreshing.
          </Text>
          <Button
            bg="#2b7ff9" color="white" borderRadius="16px" px={8}
            _hover={{ bg: "#1a6fe0" }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
          >
            Refresh page
          </Button>
        </Box>
      )
    }

    return this.props.children
  }
}
