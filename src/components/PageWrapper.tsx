"use client";

import dynamic from "next/dynamic";

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
);

export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageNavbar />
      {children}
    </>
  );
}
