import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "@/styles/globals.css";
import { PageWrapper } from "@/components/PageWrapper";

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
      <body>
        <Providers>
          <PageWrapper>{children}</PageWrapper></Providers>
      </body>
    </html>
  );
}
