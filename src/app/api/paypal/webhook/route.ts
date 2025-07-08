import { NextResponse } from "next/server";
export async function POST(req: Request) {
  try {
    const event = await req.json();


    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        // Handle subscription creation
        // Here you would update your database with the subscription details
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        // Handle subscription cancellation
        break;

      case 'PAYMENT.SALE.COMPLETED':
        // Handle successful payment
        break;

      default:
        console.log(`Unhandled event type: ${event.event_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
