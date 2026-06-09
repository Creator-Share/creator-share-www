import type { ReactNode } from "react"
import { AppNavWrapper } from "./components/AppNavWrapper"

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex"
      style={{
        minHeight: "calc(100vh - 64px)",
        width: "100dvw",
        marginLeft: "calc(-50dvw + 50%)",
      }}
    >
      <AppNavWrapper />
      <main className="flex-1 min-w-0" style={{ backgroundColor: "#f8fafb" }}>
        {children}
      </main>
    </div>
  )
}
