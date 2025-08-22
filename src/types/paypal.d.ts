declare module '@paypal/checkout-server-sdk' {
  interface PayPalRequest {
    path: string;
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
  }

  interface PayPalOrderRequestBody {
    intent: 'CAPTURE' | 'AUTHORIZE';
    purchase_units: Array<{
      amount: {
        currency_code: string;
        value: string;
      };
      description?: string;
    }>;
  }

  interface PayPalSubscriptionRequestBody {
    plan_id: string;
    subscriber: {
      name?: {
        given_name: string;
        surname: string;
      };
      email_address?: string;
    };
    application_context?: {
      brand_name?: string;
      locale?: string;
      shipping_preference?: 'GET_FROM_FILE' | 'NO_SHIPPING' | 'SET_PROVIDED_ADDRESS';
      user_action?: 'CONTINUE' | 'SUBSCRIBE_NOW';
      payment_method?: {
        payer_selected?: string;
        payee_preferred?: string;
      };
    };
  }

  namespace core {
    class PayPalHttpClient {
      constructor(environment: SandboxEnvironment | LiveEnvironment);
      execute<T>(request: PayPalRequest): Promise<T>;
    }

    class SandboxEnvironment {
      constructor(clientId: string, clientSecret: string);
    }

    class LiveEnvironment {
      constructor(clientId: string, clientSecret: string);
    }
  }

  namespace orders {
    class OrdersCreateRequest {
      requestBody(body: PayPalOrderRequestBody): void;
    }
  }

  namespace subscriptions {
    class SubscriptionsCreateRequest {
      requestBody(body: PayPalSubscriptionRequestBody): void;
    }
  }
}

declare module '@paypal/react-paypal-js' {
  export interface PayPalButtonsComponentProps {
    createOrder?: (data: Record<string, unknown>, actions: {
      order: {
        create: (options: {
          purchase_units: Array<{
            description?: string;
            amount: {
              value: string;
              currency_code: string;
            };
          }>;
        }) => Promise<string>;
      };
    }) => Promise<string>;
    onApprove?: (data: {
      orderID: string;
    }, actions: {
      order: {
        capture: () => Promise<{
          id: string;
          status: string;
          purchase_units: Array<{
            payments?: {
              captures?: Array<{
                id: string;
                status: string;
              }>;
            };
          }>;
        }>;
      };
    }) => Promise<void>;
    onError?: (err: Error) => void;
    style?: {
      layout?: 'vertical' | 'horizontal';
      color?: 'gold' | 'blue' | 'silver' | 'black' | 'white';
      shape?: 'rect' | 'pill';
      label?: 'paypal' | 'checkout' | 'buynow' | 'pay' | 'subscribe';
      height?: number;
      tagline?: boolean;
    };
  }

  export interface PayPalScriptProviderProps {
    options: {
      'client-id': string;
      currency?: string;
      intent?: 'capture' | 'authorize' | 'subscription' | 'tokenize';
    };
    children?: React.ReactNode;
  }

  export const PayPalScriptProvider: React.FC<PayPalScriptProviderProps>;
  export const PayPalButtons: React.FC<PayPalButtonsComponentProps>;
}
