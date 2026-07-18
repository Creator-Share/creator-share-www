declare module "@paypal/checkout-server-sdk" {
  interface PayPalRequest {
    path: string
    method: string
    headers?: Record<string, string>
    body?: unknown
  }

  interface PayPalOrderRequestBody {
    intent: "CAPTURE" | "AUTHORIZE"
    purchase_units: Array<{
      amount: {
        currency_code: string
        value: string
      }
      description?: string
    }>
  }

  interface PayPalSubscriptionRequestBody {
    plan_id: string
    subscriber: {
      name?: {
        given_name: string
        surname: string
      }
      email_address?: string
    }
    application_context?: {
      brand_name?: string
      locale?: string
      shipping_preference?:
        | "GET_FROM_FILE"
        | "NO_SHIPPING"
        | "SET_PROVIDED_ADDRESS"
      user_action?: "CONTINUE" | "SUBSCRIBE_NOW"
      payment_method?: {
        payer_selected?: string
        payee_preferred?: string
      }
    }
  }

  namespace core {
    class PayPalHttpClient {
      constructor(environment: SandboxEnvironment | LiveEnvironment)
      execute<T>(request: PayPalRequest): Promise<T>
    }

    class SandboxEnvironment {
      constructor(clientId: string, clientSecret: string)
    }

    class LiveEnvironment {
      constructor(clientId: string, clientSecret: string)
    }
  }

  namespace orders {
    class OrdersCreateRequest {
      requestBody(body: PayPalOrderRequestBody): void
    }
  }

  namespace subscriptions {
    class SubscriptionsCreateRequest {
      requestBody(body: PayPalSubscriptionRequestBody): void
    }
  }
}
