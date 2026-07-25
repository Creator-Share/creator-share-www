import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Markup safety in the advocate invitation email.
 *
 * A mutation campaign found that removing `escapeHtml` from the advocate
 * display name left the entire required suite green. Nothing anywhere asserted
 * escaping for this module.
 *
 * The display name is operator-supplied and reaches the HTML body directly.
 * Its only database constraint is a length check between 1 and 160 characters,
 * with no character class restriction, and the envelope parser rejects only
 * control characters, so angle brackets and quotes pass. This renderer builds
 * the entire message body and nothing downstream sanitizes it, which makes
 * `escapeHtml` the sole defense.
 *
 * A name such as `Hope <a href="https://evil.example/login">Verify now</a>`
 * would otherwise be delivered as live markup inside a Creator Share branded
 * transactional email, carrying an attacker-controlled link to an invited third
 * party on a trusted message.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/invitation-email-escaping.spec.ts"),
)
const { renderAdvocateInvitationEmail } = testRequire(
  "../../src/lib/advocates/invitations/emailRenderer",
) as typeof import("../../src/lib/advocates/invitations/emailRenderer")
const { parseAdvocateInvitationEmailTemplateData } = testRequire(
  "../../src/lib/advocates/invitations/emailEnvelope",
) as typeof import("../../src/lib/advocates/invitations/emailEnvelope")
nodeModule._load = originalModuleLoad

const AUTH_TOKEN_HASH = "a".repeat(64)
const CAPABILITY = "b".repeat(64)
const INVITATION_ID = "77777777-7777-4777-8777-777777777777"

/** A name that is a working phishing payload if it reaches the body unescaped. */
const HOSTILE_NAME =
  'Hope <a href="https://evil.example/login">Verify now</a> & Partners'

function renderDelegate(displayName: string) {
  return renderAdvocateInvitationEmail({
    canonicalOrigin: "https://creatorshare.com",
    template: parseAdvocateInvitationEmailTemplateData(
      "advocate_delegate_invitation_v1",
      {
        advocate_display_name: displayName,
        invitation_id: INVITATION_ID,
        // The parser requires the role list already sorted.
        role_keys: ["administrator", "brand_editor"],
      },
    ),
    authTokenHash: AUTH_TOKEN_HASH,
    authType: "magiclink",
    capability: CAPABILITY,
  })
}

function renderInitialOwner(displayName: string) {
  return renderAdvocateInvitationEmail({
    canonicalOrigin: "https://creatorshare.com",
    template: parseAdvocateInvitationEmailTemplateData(
      "advocate_initial_owner_invitation_v1",
      { advocate_display_name: displayName, invitation_id: INVITATION_ID },
    ),
    authTokenHash: AUTH_TOKEN_HASH,
    authType: "magiclink",
    capability: CAPABILITY,
  })
}

test.describe("advocate invitation email markup safety", () => {
  test("the delegate invitation escapes a hostile display name", async () => {
    const rendered = renderDelegate(HOSTILE_NAME)

    // The decisive assertion: no live anchor from operator-supplied text.
    expect(rendered.html).not.toContain('<a href="https://evil.example/login"')
    expect(rendered.html).not.toContain("Verify now</a>")

    // And it is escaped rather than silently dropped, so the name still reads
    // correctly to the recipient.
    expect(rendered.html).toContain("&lt;a href=&quot;https://evil.example")
    expect(rendered.html).toContain("&amp; Partners")
  })

  test("the initial owner invitation escapes a hostile display name", async () => {
    const rendered = renderInitialOwner(HOSTILE_NAME)

    // Two separate templates build two separate bodies. Covering only one
    // leaves the other free to regress.
    expect(rendered.html).not.toContain('<a href="https://evil.example/login"')
    expect(rendered.html).not.toContain("Verify now</a>")
    expect(rendered.html).toContain("&lt;a href=&quot;https://evil.example")
  })

  test("escapes every character that could break out of markup or an attribute", async () => {
    const rendered = renderDelegate(`< > " ' &`)

    for (const [raw, escaped] of [
      ["&", "&amp;"],
      ['"', "&quot;"],
      ["'", "&#39;"],
      ["<", "&lt;"],
      [">", "&gt;"],
    ] as const) {
      expect(rendered.html, `${raw} must be escaped as ${escaped}`).toContain(
        escaped,
      )
    }

    // Ampersand must be escaped first or the other entities get double-encoded
    // into visible mojibake such as &amp;lt;.
    expect(rendered.html).not.toContain("&amp;lt;")
    expect(rendered.html).not.toContain("&amp;quot;")
  })

  test("the only Creator Share links in the body are the invitation and support", async () => {
    const rendered = renderDelegate(HOSTILE_NAME)

    const hrefs = [...rendered.html.matchAll(/href="([^"]*)"/g)].map(
      (match) => match[1],
    )
    // Every destination must be one Creator Share origin or the support
    // mailto. An injected name adding a sixth destination is the attack.
    for (const href of hrefs) {
      expect(
        href.startsWith("https://creatorshare.com/") ||
          href === "mailto:support@creatorshare.com",
        `unexpected link destination in invitation email: ${href}`,
      ).toBe(true)
    }
    expect(hrefs.length).toBeGreaterThan(0)
  })

  test("the plain text part carries the name verbatim", async () => {
    const rendered = renderDelegate(HOSTILE_NAME)

    // A text/plain part does not interpret markup, so escaping there would
    // show entity noise to the reader. This pins escaping as an HTML concern
    // and stops a well-meant change from escaping the text body too.
    expect(rendered.text).toContain(HOSTILE_NAME)
    expect(rendered.text).not.toContain("&lt;")
    expect(rendered.text).not.toContain("&amp;")
  })
})
