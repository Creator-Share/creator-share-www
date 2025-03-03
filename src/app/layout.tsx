import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "@/styles/globals.css";
import { PageWrapper } from "@/components/PageWrapper";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Creator Share",
  description: "",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className="bg-[#F5F5F5]">
        <Providers>
          <PageWrapper>{children}</PageWrapper>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
