"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
);

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsEmbedded(params.get("embedded") === "true");
  }, []);

  return (
    <>
      {!isEmbedded && <PageNavbar />}
      <div className="w-full max-w-[1200px] mx-auto px-3 md:px-8">
        {children}
      </div>
    </>
  );
}
