import { NextResponse } from "next/server"
import { getPayPalOrder, isPayPalEnabled } from "@/lib/paypal/client"

export async function GET(request: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("id")

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required", code: "ORDER_ID_REQUIRED" },
        { status: 400 },
      )
    }

    const result = await getPayPalOrder(orderId)
    if (!result.ok || !result.order) {
      return NextResponse.json(
        { error: "Failed to fetch order details", code: "ORDER_NOT_FOUND" },
        { status: 404 },
      )
    }

    const orderData = result.order
    const firstUnit = orderData.purchase_units?.[0]

    // Format the response to match the structure expected by the success page.
    const formattedResponse = {
      session: {
        metadata: {
          type: "sponsorship",
          childName:
            firstUnit?.description?.split(" for ")[1] || "your sponsored child",
          childLocation:
            firstUnit?.shipping?.address?.country_code || "",
          amount: (
            parseFloat(firstUnit?.amount?.value || "0") * 100
          ).toString(),
          paymentType: firstUnit?.description?.includes("Monthly")
            ? "subscription"
            : "yearly",
        },
        customer_details: {
          email: orderData.payer?.email_address || "",
        },
      },
    }

    return NextResponse.json(formattedResponse)
  } catch (error) {
    console.error("Error fetching PayPal order:", error)
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 },
    )
  }
}
