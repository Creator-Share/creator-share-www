import { PageNavbar } from "./PageNavbar";

export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageNavbar />
      {children}
    </>
  );
}
