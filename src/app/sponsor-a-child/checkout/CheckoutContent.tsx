'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Text } from '@chakra-ui/react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string);

export default function CheckoutContent() {
  const searchParams = useSearchParams();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const secret = searchParams.get('client_secret');
    if (secret) {
      setClientSecret(secret);
    } else {
      setError('No client secret provided');
    }
  }, [searchParams]);

  if (error) {
    return (
      <Box className="p-4">
        <Text color="red.500">{error}</Text>
      </Box>
    );
  }

  if (!clientSecret) {
    return (
      <Box className="p-4">
        <Text>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box className="w-full min-h-screen p-4">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </Box>
  );
} 