import React from 'react'
import Image from 'next/image'

const IframeTest = () => {
  return (
    <div className="min-h-screen">
      <header className="bg-blue-900 p-4">
        <nav className="text-white">
          <div className="container mx-auto">
            <Image
              src="https://static.wixstatic.com/media/8325b4_ca6753257e4b4b6eaabae9b5b7ca183d~mv2.png"
              alt="Logo"
              width={410}
              height={186}
              className="h-12 w-auto"
              priority
            />
            <a href="#" className="mx-4">Home</a>
            <a href="#" className="mx-4">About</a>
            <a href="#" className="mx-4">Sponsor</a>
            <a href="#" className="mx-4">Contact</a>
          </div>
        </nav>
      </header>

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