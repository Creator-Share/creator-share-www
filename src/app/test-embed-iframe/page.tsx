"use client"

import React, { useEffect, useRef, useState } from "react"

const IframeTest = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.includes("localhost:3000")) return

      // Handle iframe resizing
      if (event.data?.type === "resize" && iframeRef.current) {
        const iframe = iframeRef.current
        iframe.style.transition = "none"
        iframe.style.height = `${event.data.height}px`

        requestAnimationFrame(() => {
          iframe.style.transition = "height 0.3s ease"
        })
      }

      // Handle makeDialogSticky message from the iframe
      if (event.data?.type === "makeDialogSticky") {
        console.log("Received makeDialogSticky request from iframe", event.data)

        // We don't need to scroll - the dialog should stay in place
        // Just ensure the iframe is visible
        if (iframeRef.current) {
          // Make sure the iframe is visible
          const iframeRect = iframeRef.current.getBoundingClientRect()
          if (iframeRect.top < 0 || iframeRect.bottom > window.innerHeight) {
            iframeRef.current.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        }
      }

      // Handle sponsorship complete message
      else if (event.data?.type === "sponsorship_complete") {
        console.log("Received sponsorship_complete from iframe", event.data)
        setPaymentStatus("complete")

        // You could show a success message or redirect the user
        if (iframeRef.current) {
          iframeRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }
      }

      // Handle navigation message
      else if (event.data?.type === "navigation") {
        console.log("Received navigation request from iframe", event.data)

        if (event.data.action === "return") {
          // Reset the iframe to the embed page
          if (iframeRef.current) {
            iframeRef.current.src =
              "http://localhost:3000/embed?embedded=true&parentOrigin=http://localhost:3000"
            setPaymentStatus(null)
          }
        }
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning={true}>
      <div className="container mx-auto p-4">
        <div className="mb-8 p-4 bg-white rounded-xl shadow-sm">
          <h2 className="text-xl font-semibold mb-4">
            Implementation Reference
          </h2>
          <div>
            <h3 className="font-medium mb-2">Webflow Custom Code</h3>
            <div className="relative">
              <textarea
                ref={(el) => {
                  if (el) {
                    el.value = `<!-- Add this to your Webflow page -->
<iframe 
  src="https://yoursite.com/embed?embedded=true&parentOrigin=https://share-tanzania.webflow.io" 
  width="100%" 
  style="border: none; height: 500px; transition: height 0.3s ease; display: block; width: 100%;"
  scrolling="no"
></iframe>

<script>
// Handle iframe resizing and scrolling
window.addEventListener('message', function(event) {
    // Replace with your domain in production
    if (!event.origin.includes('yoursite.com')) return;
    
    if (event.data?.type === 'resize') {
        var iframe = document.querySelector('iframe[src*="embedded=true"]');
        if (!iframe) return;
        
        var transition = iframe.style.transition;
        iframe.style.transition = 'none';
        iframe.style.height = event.data.height + 'px';
        
        setTimeout(function() {
            iframe.style.transition = transition;
        }, 50);
    }
    
    // Handle makeDialogSticky message from the iframe
    if (event.data?.type === 'makeDialogSticky') {
        console.log('Received makeDialogSticky request from iframe', event.data);
        
        // We don't need to scroll - the dialog should stay in place
        // Just ensure the iframe is visible
        var iframe = document.querySelector('iframe[src*="embedded=true"]');
        if (iframe) {
            // Make sure the iframe is visible
            var iframeRect = iframe.getBoundingClientRect();
            if (iframeRect.top < 0 || iframeRect.bottom > window.innerHeight) {
                iframe.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }
    }
    
    // Handle sponsorship complete message
    else if (event.data?.type === 'sponsorship_complete') {
        console.log('Received sponsorship_complete from iframe', event.data);
        
        // You could show a success message or redirect the user
        var iframe = document.querySelector('iframe[src*="embedded=true"]');
        if (iframe) {
            iframe.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
    
    // Handle navigation message
    else if (event.data?.type === 'navigation') {
        console.log('Received navigation request from iframe', event.data);
        
        if (event.data.action === 'return') {
            // Reset the iframe to the embed page
            var iframe = document.querySelector('iframe[src*="embedded=true"]');
            if (iframe) {
                iframe.src = "https://yoursite.com/embed?embedded=true&parentOrigin=https://share-tanzania.webflow.io";
            }
        }
    }
}, false);

// Request initial height
window.addEventListener('load', function() {
    setTimeout(function() {
        var iframe = document.querySelector('iframe[src*="embedded=true"]');
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'requestHeight' }, '*');
        }
    }, 2000);
});
</script>`
                  }
                }}
                readOnly
                rows={4}
                className="w-full bg-gray-100 p-4 rounded-lg text-sm font-mono resize-none"
              />
              <button
                onClick={() => {
                  const textarea = document.querySelector("textarea")
                  if (!textarea) return

                  const button = document.querySelector(
                    "[data-copy-button]"
                  ) as HTMLButtonElement
                  const originalText = button.textContent
                  navigator.clipboard.writeText(textarea.value).then(() => {
                    button.textContent = "Copied!"
                    setTimeout(() => {
                      button.textContent = originalText
                    }, 2000)
                  })
                }}
                data-copy-button
                className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        </div>

        {paymentStatus === "complete" && (
          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded-xl text-green-800">
            <h3 className="font-semibold text-lg mb-2">
              Thank you for your sponsorship!
            </h3>
            <p>
              Your payment has been successfully processed. A confirmation email
              will be sent to you shortly.
            </p>
          </div>
        )}

        <div className="border rounded-xl overflow-hidden bg-white shadow-sm max-h-screen">
          <iframe
            ref={iframeRef}
            src="http://localhost:3000/embed?embedded=true&parentOrigin=http://localhost:3000"
            className="w-full max-h-screen"
            style={{
              border: "none",
              width: "100%",
              display: "block",
              transition: "height 0.3s ease",
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default IframeTest
