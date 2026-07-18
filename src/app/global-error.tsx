"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  void error

  return (
    <html lang="en" data-theme="light" style={{ colorScheme: "light" }}>
      <body className="m-0 bg-white font-sans text-slate-950">
        <main className="flex min-h-screen items-center justify-center px-6 py-16">
          <div className="max-w-md text-center">
            <h1 className="text-3xl font-bold">We could not load this page</h1>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Please try again. If the problem continues, come back in a few
              minutes.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
