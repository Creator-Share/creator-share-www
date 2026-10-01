export interface ProviderCheckoutReturnUrls {
  successUrl: string
  cancelUrl: string
}

export function stripeCheckoutReturnUrls(
  checkoutBaseUrl: string,
): ProviderCheckoutReturnUrls {
  return {
    successUrl: `${checkoutBaseUrl}/payments/success`,
    cancelUrl: `${checkoutBaseUrl}/payments/failed`,
  }
}

export function paypalCheckoutReturnUrls(
  checkoutBaseUrl: string,
): ProviderCheckoutReturnUrls {
  return {
    successUrl: `${checkoutBaseUrl}/payments/success?provider=paypal`,
    cancelUrl: `${checkoutBaseUrl}/payments/failed?provider=paypal`,
  }
}
