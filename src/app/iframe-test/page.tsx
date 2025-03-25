"use client";

import React, { useEffect, useRef } from "react";

const IframeTest = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // In production, replace with actual domain check
      if (!event.origin.includes(window.location.origin)) return;
      
      if (event.data?.type === "resize") {
        const iframe = iframeRef.current;
        if (!iframe) return;

        try {
          // Clear any pending resize timeout
          if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
          }

          // Store original transition
          const originalTransition = iframe.style.transition;
          
          // Temporarily disable transition
          iframe.style.transition = 'none';
          
          // Remove any constraints
          iframe.style.minHeight = '0';
          iframe.style.maxHeight = 'none';
          
          // Force reflow
          void iframe.offsetHeight;
          
          // Set new height
          iframe.style.height = `${event.data.height}px`;
          
          // Force reflow again
          void iframe.offsetHeight;
          
          // Log detailed height information
          console.log('Parent: Height details', {
            receivedHeight: event.data.height,
            iframeScrollHeight: iframe.scrollHeight,
            iframeOffsetHeight: iframe.offsetHeight,
            iframeClientHeight: iframe.clientHeight
          });
          
          // Restore transition after a short delay
          resizeTimeoutRef.current = setTimeout(() => {
            iframe.style.transition = originalTransition;
            resizeTimeoutRef.current = null;
          }, 50);
        } catch (error) {
          console.error('Error resizing iframe:', error);
        }
      }
    };

    window.addEventListener("message", handleMessage);

    // Request initial height when iframe loads
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', () => {
        // Give a small delay to ensure content is rendered
        setTimeout(() => {
          iframe.contentWindow?.postMessage({ type: 'requestHeight' }, '*');
        }, 100);
      });
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      const iframe = iframeRef.current;
      if (iframe) {
        iframe.removeEventListener('load', () => {});
      }
    };
  }, []);

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
            src="/sponsor-a-child?embedded=true&parentOrigin=http://localhost:3000"
            className="w-full"
            style={{ 
              border: "none", 
              height: "500px", 
              transition: "height 0.3s ease",
              minHeight: "0",
              maxHeight: "none",
              display: "block",
              width: "100%",
              overflow: "hidden"
            }}
            scrolling="no"
          />
        </div>
      </div>
    </div>
  );
};

export default IframeTest;
