import React from 'react'
import Image from 'next/image'

const IframeTest = () => {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto p-4">
        <div className="border rounded-lg overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
          <iframe
            src="/sponsor-a-child?embedded=true"
            className="w-full h-full"
          />
        </div>
      </div>
    </div>
  )
}

export default IframeTest 