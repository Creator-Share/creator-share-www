"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import type { AdvocatePortalNavigationItem } from "@/components/advocates/admin/PortalShell"

function normalizedPathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname
}

export function currentAdvocatePortalNavigationHref(
  pathname: string,
  navigation: readonly AdvocatePortalNavigationItem[],
): string | null {
  const currentPath = normalizedPathname(pathname)
  return (
    navigation
      .flatMap((item) => (item.href ? [item.href] : []))
      .sort((left, right) => right.length - left.length)
      .find(
        (href) => currentPath === href || currentPath.startsWith(`${href}/`),
      ) ?? null
  )
}

export function PortalNavigation({
  navigation,
}: {
  navigation: readonly AdvocatePortalNavigationItem[]
}) {
  const pathname = usePathname()
  const currentHref = currentAdvocatePortalNavigationHref(pathname, navigation)

  return (
    <nav aria-label="Advocate portal" className="self-start">
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {navigation.map((item) => {
          const current = item.href !== null && item.href === currentHref
          return (
            <li key={item.section}>
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={
                    current
                      ? "flex min-h-11 items-center rounded-md bg-blue-700 px-4 py-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                      : "flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  }
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-500"
                >
                  <span>{item.label}</span>
                  <span className="text-xs font-normal text-gray-400">
                    Coming soon
                  </span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
