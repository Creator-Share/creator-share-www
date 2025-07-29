import { Suspense } from "react";
import PaymentSuccessClient from "./PaymentSuccessClient";

function Loading() {
  return (
    <div style={{ minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      Loading payment status...
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PaymentSuccessClient />
    </Suspense>
  );
}
