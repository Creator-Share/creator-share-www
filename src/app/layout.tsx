import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "./msw";

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
