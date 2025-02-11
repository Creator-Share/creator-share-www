"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from 'react';

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
);

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsEmbedded(params.get('embedded') === 'true');
  }, []);

  return (
    <>
      {!isEmbedded && <PageNavbar />}
      {children}
    </>
  );
}