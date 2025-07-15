import { Providers } from "@/components/Providers";
import { Toaster } from "@/components/ui/toaster";
import "@/styles/globals.css";

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      {children}
      <Toaster />
    </Providers>
  );
}
