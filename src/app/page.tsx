"use client";
import { Categories } from "@/components/Categories";
import { Hero } from "@/components/Hero";
import { Story } from "@/components/Story";
import { Testimonials } from "@/components/Testimonials";
import {
  Box,
  Container,
} from "@chakra-ui/react";

import React from "react";


export default function Home() {
  return (
    <Box>
      <Hero />
      <Container maxW={'1200px'}>
      <Story />
      <Categories />
      <Testimonials />
      </Container>
    </Box>
  );
}
