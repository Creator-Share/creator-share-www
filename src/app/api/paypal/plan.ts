import { NextResponse } from "next/server";

const PAYPAL_API_URL = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("PayPal token error response:", errorText);
    throw new Error("Failed to get PayPal access token");
  }

  const data = await response.json();
  return data.access_token;
}

async function createPayPalProduct(beneficiary_id: string, name: string, description: string, accessToken: string) {
  // Try to create a product with beneficiary_id as the product_id
  const response = await fetch(`${PAYPAL_API_URL}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: beneficiary_id,
      name,
      description,
      type: "SERVICE",
      category: "CHARITY",
    }),
  });

  // If product already exists, PayPal will return an error, but that's fine
  if (response.ok) {
    return beneficiary_id;
  } else {
    const data = await response.json();
    // If product already exists, just return the id
    if (data?.name === "RESOURCE_ALREADY_EXISTS") {
      return beneficiary_id;
    }
    throw new Error(data?.message || "Failed to create PayPal product");
  }
}

export async function POST(request: Request) {
  try {
    const { beneficiary_id, name, description, amount, interval_unit, interval_count = 1, currency_code = "USD" } = await request.json();

    const accessToken = await getPayPalAccessToken();

    // Create the product with beneficiary_id as product_id
    await createPayPalProduct(beneficiary_id, name, description, accessToken);

    // Create the plan
    const response = await fetch(`${PAYPAL_API_URL}/v1/billing/plans`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: beneficiary_id,
        name,
        description,
        status: "ACTIVE",
        billing_cycles: [
          {
            frequency: {
              interval_unit, // "MONTH" or "YEAR"
              interval_count, // 1 for monthly/yearly
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0, // 0 = infinite
            pricing_scheme: {
              fixed_price: {
                value: amount.toFixed(2),
                currency_code,
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal plan creation error:", data);
      return NextResponse.json({ error: data }, { status: 400 });
    }

    return NextResponse.json({ plan: data });
  } catch (error) {
    console.error("Error creating PayPal plan:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
