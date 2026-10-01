import Link from "next/link"

export function NotFoundContent() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          404
        </p>
        <h1 className="mt-3 text-3xl font-bold text-slate-950">
          Page not found
        </h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          This page is unavailable or does not exist.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Return home
        </Link>
      </div>
    </main>
  )
}
