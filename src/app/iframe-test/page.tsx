'use client';

import React, { useEffect, useRef, useState } from 'react';

const IframeTest = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState('calc(100vh - 200px)');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify the message origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'resize') {
        setIframeHeight(`${event.data.height}px`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="min-h-screen">
      <div className="container mx-auto p-4">
        <div className="border rounded-xl overflow-hidden">
          <iframe
            ref={iframeRef}
            src="/sponsor-a-child?embedded=true"
            className="w-full"
            style={{ height: iframeHeight }}
          />
        </div>
      </div>
    </div>
  );
};

export default IframeTest; 