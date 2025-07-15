'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { Box, Text, Image } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

const Loader = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const hasVisited = Cookies.get('has_visited');

    if (!hasVisited) {
      Cookies.set('has_visited', 'true', { expires: 365 });
      setTimeout(() => {
        router.push('/sponsorships');
      }, 2000);
    } else {
      setTimeout(() => {
        setFadingOut(true);
        setTimeout(() => setLoading(false), 1000); // Match fade-out duration
      }, 2000); // Artificial delay to show loader
    }
  }, [router]);

  if (!loading) {
    return null;
  }

  return (
    <Box
      position="fixed"
      top="0"
      left="0"
      width="100vw"
      height="100vh"
      bg="white"
      zIndex="9999"
      display="flex"
      alignItems="center"
      justifyContent="center"
      animation={fadingOut ? `${fadeOut} 0.5s forwards` : ''}
    >
      <Box display="flex" flexDirection="column" alignItems="center">
        <Image src="/creator-text.svg" alt="Creator Share" width="200px" mb={4} />
        <Text fontSize="xl" fontWeight="bold">
          Preparing to make a difference...
        </Text>
      </Box>
    </Box>
  );
};

export default Loader;