"use client";

import React, { useEffect, useRef, useState } from "react";

const IframeTest = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState('calc(100vh - 200px)');

  useEffect(() => {

    const handleMessage = (event: MessageEvent) => {
      // Verify the message origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === "resize") {
        setIframeHeight(`${event.data.height}px`);
      }
    };

    window.addEventListener("message", handleMessage);

    // Use the stored ref value in cleanup
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []); // iframeRef is stable, so it doesn't need to be in deps

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-4">
        {/* Example implementation section */}
        <div className="mb-8 p-4 bg-white rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Implementation Reference</h2>
          <div>
            <h3 className="font-medium mb-2">Webflow Custom Code</h3>
            <div className="relative">
              <textarea
                ref={(el) => {
                  if (el) {
                    el.value = `<!-- Add this to your Webflow page -->
<iframe 
  src="http://localhost:3000/sponsor-a-child?embedded=true&parentOrigin=https://share-tanzania.webflow.io" 
  width="100%" 
  style="border: none; height: 500px; transition: height 0.3s ease; display: block; width: 100%;"
  scrolling="no"
></iframe>

<script>
// Handle iframe resizing
window.addEventListener('message', function(event) {
    // Replace localhost:3000 with your domain in production
    if (!event.origin.includes('localhost:3000')) return;
    
    if (event.data?.type === 'resize') {
        var iframe = document.querySelector('iframe[src*="sponsor-a-child"]');
        if (!iframe) return;
        
        var transition = iframe.style.transition;
        iframe.style.transition = 'none';
        iframe.style.height = event.data.height + 'px';
        
        setTimeout(function() {
            iframe.style.transition = transition;
        }, 50);
    }
}, false);

// Request initial height
window.addEventListener('load', function() {
    setTimeout(function() {
        var iframe = document.querySelector('iframe[src*="sponsor-a-child"]');
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'requestHeight' }, '*');
        }
    }, 2000);
});
</script>`;
                  }
                }}
                readOnly
                rows={4}
                className="w-full bg-gray-100 p-4 rounded-lg text-sm font-mono resize-none"
              />
              <button
                onClick={() => {
                  const textarea = document.querySelector('textarea');
                  if (!textarea) return;
                  
                  const button = document.querySelector('[data-copy-button]') as HTMLButtonElement;
                  const originalText = button.textContent;
                  navigator.clipboard.writeText(textarea.value).then(() => {
                    button.textContent = 'Copied!';
                    setTimeout(() => {
                      button.textContent = originalText;
                    }, 2000);
                  });
                }}
                data-copy-button
                className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        {/* Live example section */}
        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
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
