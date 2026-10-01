import "server-only"

import { isIP } from "node:net"

/** Only the configured ingress may supply network identity or trace evidence.
 * https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
 * Cloudflare is DNS-only; its headers are not an authenticated proxy signal.
 */
export function readRequestForensics(
  headers: Pick<Headers, "get">,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { traceId: string | null; clientIp: string | null; userAgent: string | null } {
  const bounded = (name: string, limit: number): string | null => {
    const value = headers.get(name)?.trim()
    return value &&
      Buffer.byteLength(value, "utf8") <= limit &&
      !/[\u0000-\u001f\u007f-\u009f]/.test(value)
      ? value
      : null
  }
  const onVercel = environment.VERCEL === "1"
  const source = onVercel ? bounded("x-vercel-forwarded-for", 64) : null
  const trace = onVercel ? bounded("x-vercel-id", 255) : null
  return {
    traceId: trace !== null && /^[\x21-\x7e]+$/.test(trace) ? trace : null,
    clientIp: source !== null && isIP(source) !== 0 ? source.toLowerCase() : null,
    userAgent: bounded("user-agent", 1024),
  }
}
