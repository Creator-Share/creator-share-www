import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const loader = Module as unknown as {
  _load: (name: string, ...args: unknown[]) => unknown
}
const original = loader._load
let readRequestForensics: typeof import("../src/lib/requestForensics").readRequestForensics
try {
  loader._load = (name, ...args) =>
    name === "server-only" ? {} : original.call(Module, name, ...args)
  const testRequire = createRequire(resolve(process.cwd(), "tests/request-forensics.spec.ts"))
  ;({ readRequestForensics } = testRequire("../src/lib/requestForensics"))
} finally {
  loader._load = original
}

const forgedHeaders = {
  "cf-connecting-ip": "192.0.2.10",
  "x-forwarded-for": "192.0.2.11",
  "x-real-ip": "192.0.2.12",
  "cf-ray": "forged-cloudflare-trace",
  traceparent: "forged-parent-trace",
  "x-trace-id": "forged-client-trace",
  "user-agent": "test browser",
}

test("uses only valid Vercel ingress evidence despite competing proxy headers", () => {
  expect(readRequestForensics(new Headers({
    ...forgedHeaders,
    "x-vercel-forwarded-for": "203.0.113.9",
    "x-vercel-id": "sfo1::trusted-ingress",
  }), { VERCEL: "1" })).toEqual({
    clientIp: "203.0.113.9",
    traceId: "sfo1::trusted-ingress",
    userAgent: "test browser",
  })
})

test("does not promote proxy assertions when trusted ingress evidence is absent", () => {
  for (const environment of [{}, { VERCEL: "0" }, { VERCEL: "1" }]) {
    expect(readRequestForensics(new Headers(forgedHeaders), environment)).toEqual({
      clientIp: null,
      traceId: null,
      userAgent: "test browser",
    })
  }
  expect(readRequestForensics(new Headers({
    "x-vercel-forwarded-for": "203.0.113.9",
    "x-vercel-id": "forged-outside-vercel",
  }), {})).toMatchObject({ clientIp: null, traceId: null })
})

test("rejects malformed and multiple source IPs rather than choosing one", () => {
  for (const source of ["203.0.113.9, 192.0.2.10", "unknown", "203.0.113.9:443", "x".repeat(65)]) {
    expect(readRequestForensics(new Headers({
      ...forgedHeaders, "x-vercel-forwarded-for": source,
    }), { VERCEL: "1" }).clientIp).toBeNull()
  }
  expect(readRequestForensics(new Headers({
    "x-vercel-forwarded-for": "2001:DB8::1",
  }), { VERCEL: "1" }).clientIp).toBe("2001:db8::1")
})

test("bounds forensic metadata by bytes and rejects control characters", () => {
  for (const trace of ["trace with spaces", "é-non-ascii", "x".repeat(256)]) {
    expect(readRequestForensics(new Headers({ "x-vercel-id": trace }), { VERCEL: "1" }).traceId).toBeNull()
  }
  for (const value of ["x".repeat(1025), "é".repeat(513), "bad\u0000value"]) {
    expect(readRequestForensics({ get: () => value }, { VERCEL: "1" })).toEqual({
      clientIp: null, traceId: null, userAgent: null,
    })
  }
})
