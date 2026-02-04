/**
 * Privacy utilities for protecting sensitive user data
 * 
 * This module provides functions for redacting personally identifiable information (PII)
 * to prevent unauthorized access while maintaining necessary functionality.
 */

/**
 * Redacts an email address for display purposes while preserving some context.
 * 
 * This function is primarily used to protect sponsor emails in the admin interface,
 * preventing admin users from accessing full email addresses while still allowing
 * them to distinguish between different sponsors.
 * 
 * @param email - The email address to redact
 * @returns Redacted email in the format: j***n@g***l.com
 * 
 * @example
 * ```typescript
 * redactEmail('john@gmail.com')
 * // Returns: 'j***n@g***l.com'
 * 
 * redactEmail('ab@test.com')
 * // Returns: 'a***b@t***t.com'
 * 
 * redactEmail('a@example.com')
 * // Returns: 'a***@e***e.com'
 * 
 * redactEmail('invalid-email')
 * // Returns: '***'
 * ```
 */
export function redactEmail(email: string): string {
  // Handle empty or invalid input
  if (!email || !email.includes("@")) {
    return "***"
  }

  const [username, domain] = email.split("@")

  // Handle edge cases where username or domain is empty
  if (!username || !domain) {
    return "***"
  }

  // Redact username: show first and last character with *** in between
  let redactedUsername: string
  if (username.length === 1) {
    redactedUsername = `${username[0]}***`
  } else if (username.length === 2) {
    redactedUsername = `${username[0]}***${username[1]}`
  } else {
    redactedUsername = `${username[0]}***${username[username.length - 1]}`
  }

  // Redact domain: show first and last character of domain name with *** in between
  // Preserve TLD (top-level domain) for context
  const domainParts = domain.split(".")
  if (domainParts.length < 2) {
    // Invalid domain format (no TLD)
    return `${redactedUsername}@***`
  }

  const domainName = domainParts[0]
  const tld = domainParts.slice(1).join(".") // Handle multi-part TLDs like co.uk

  let redactedDomain: string
  if (domainName.length === 1) {
    redactedDomain = `${domainName[0]}***`
  } else if (domainName.length === 2) {
    redactedDomain = `${domainName[0]}***${domainName[1]}`
  } else {
    redactedDomain = `${domainName[0]}***${domainName[domainName.length - 1]}`
  }

  return `${redactedUsername}@${redactedDomain}.${tld}`
}
