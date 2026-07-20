import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

import { expect, test } from "@playwright/test"
import ts from "typescript"

type AuthCall = {
  file: string
  method: string
  node: ts.CallExpression
  sourceFile: ts.SourceFile
}

type ProofIdentifierUse = {
  file: string
  method: string
}

const ROOT = process.cwd()
const SOURCE_ROOT = resolve(ROOT, "src")
const CENTRAL_ISSUER = "src/lib/auth/supabaseEmailProofIssuer.ts"
const PROOF_METHODS = new Set([
  "auth.signInWithOtp",
  "auth.signUp",
  "auth.resetPasswordForEmail",
  "auth.admin.inviteUserByEmail",
  "auth.admin.generateLink",
  "auth.resend",
])
const CLASSIFIED_NON_PROOF_METHODS = new Set([
  "auth.exchangeCodeForSession",
  "auth.getClaims",
  "auth.getUser",
  "auth.onAuthStateChange",
  "auth.setSession",
  "auth.signInWithPassword",
  "auth.signOut",
  "auth.updateUser",
  "auth.verifyOtp",
])

const EXPECTED_CENTRAL_CALLS = Object.freeze([
  `${CENTRAL_ISSUER}:auth.admin.generateLink`,
  `${CENTRAL_ISSUER}:auth.admin.inviteUserByEmail`,
  `${CENTRAL_ISSUER}:auth.resetPasswordForEmail`,
  `${CENTRAL_ISSUER}:auth.signInWithOtp`,
  `${CENTRAL_ISSUER}:auth.signUp`,
])

// This list is deliberately temporary and exact. Each route migration must
// remove its entry. New entries are never an acceptable way to make this test
// green because the central issuer is the only approved destination.
const EXPECTED_LEGACY_CALLS = Object.freeze([
  "src/app/api/admin/users/invite/route.ts:auth.admin.inviteUserByEmail",
  "src/lib/advocates/invitations/emailAuth.ts:auth.admin.generateLink",
])

const EXPECTED_PASSWORD_ONLY_UPDATE_CALLS = Object.freeze([
  "src/app/api/auth/change-password/route.ts",
  "src/app/set-password/page.tsx",
])

const EXPECTED_PROOF_IDENTIFIER_FILES = Object.freeze({
  generateLink: Object.freeze([
    CENTRAL_ISSUER,
    "src/lib/advocates/invitations/emailAuth.ts",
  ]),
  inviteUserByEmail: Object.freeze([
    CENTRAL_ISSUER,
    "src/app/api/admin/users/invite/route.ts",
  ]),
  resend: Object.freeze([]),
  resetPasswordForEmail: Object.freeze([CENTRAL_ISSUER]),
  signInWithOtp: Object.freeze([CENTRAL_ISSUER]),
  signUp: Object.freeze([CENTRAL_ISSUER]),
})

const EXPECTED_PROOF_IDENTIFIER_COUNTS = Object.freeze({
  [`${CENTRAL_ISSUER}:generateLink`]: 2,
  [`${CENTRAL_ISSUER}:inviteUserByEmail`]: 2,
  [`${CENTRAL_ISSUER}:resetPasswordForEmail`]: 2,
  [`${CENTRAL_ISSUER}:signInWithOtp`]: 2,
  [`${CENTRAL_ISSUER}:signUp`]: 2,
  "src/app/api/admin/users/invite/route.ts:inviteUserByEmail": 1,
  "src/lib/advocates/invitations/emailAuth.ts:generateLink": 2,
})

const PROOF_METHOD_IDENTIFIERS = new Set(
  Object.keys(EXPECTED_PROOF_IDENTIFIER_FILES),
)

const DIRECT_EMAIL_PROOF_ENDPOINT =
  /\/auth\/v1\/(?:otp|signup|recover|invite|resend|admin\/generate_link)\b/i

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function authMethod(expression: ts.Expression): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null
  const method = expression.name.text
  const owner = expression.expression
  if (ts.isPropertyAccessExpression(owner) && owner.name.text === "auth") {
    return `auth.${method}`
  }
  if (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === "admin" &&
    ts.isPropertyAccessExpression(owner.expression) &&
    owner.expression.name.text === "auth"
  ) {
    return `auth.admin.${method}`
  }
  return null
}

function collectAuthCalls(): AuthCall[] {
  const calls: AuthCall[] = []
  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const file = relative(ROOT, absolutePath).replaceAll("\\", "/")
    const text = readFileSync(absolutePath, "utf8")
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method = authMethod(node.expression)
        if (method !== null) calls.push({ file, method, node, sourceFile })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return calls
}

function isExecutableProofMethodString(node: ts.StringLiteral): boolean {
  const parent = node.parent
  return (
    (ts.isElementAccessExpression(parent) &&
      parent.argumentExpression === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node)
  )
}

function collectProofIdentifierUses(): ProofIdentifierUse[] {
  const uses: ProofIdentifierUse[] = []
  for (const absolutePath of sourceFiles(SOURCE_ROOT)) {
    const file = relative(ROOT, absolutePath).replaceAll("\\", "/")
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(absolutePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      absolutePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && PROOF_METHOD_IDENTIFIERS.has(node.text)) {
        uses.push({ file, method: node.text })
      } else if (
        ts.isStringLiteral(node) &&
        PROOF_METHOD_IDENTIFIERS.has(node.text) &&
        isExecutableProofMethodString(node)
      ) {
        uses.push({ file, method: node.text })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return uses
}

function objectPropertyNames(value: ts.Expression): string[] | null {
  if (!ts.isObjectLiteralExpression(value)) return null
  const names: string[] = []
  for (const property of value.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      return null
    }
    const name = property.name
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return null
    names.push(name.text)
  }
  return names.sort()
}

test("locks proof-producing Supabase calls to the central issuer and exact migration debt", () => {
  const calls = collectAuthCalls()
  const proofCalls = calls
    .filter((call) => PROOF_METHODS.has(call.method))
    .map((call) => `${call.file}:${call.method}`)
    .sort()

  expect(proofCalls).toEqual(
    [...EXPECTED_CENTRAL_CALLS, ...EXPECTED_LEGACY_CALLS].sort(),
  )
  expect(proofCalls.filter((call) => call.endsWith(":auth.resend"))).toEqual([])
  expect(EXPECTED_LEGACY_CALLS).toHaveLength(2)
})

test("forces every directly called Supabase auth method into a reviewed classification", () => {
  const methods = [
    ...new Set(collectAuthCalls().map((call) => call.method)),
  ].sort()
  const unclassified = methods.filter(
    (method) =>
      !PROOF_METHODS.has(method) && !CLASSIFIED_NON_PROOF_METHODS.has(method),
  )
  expect(unclassified).toEqual([])
})

test("fails closed on proof method aliases, destructuring, and bracket access outside reviewed files", () => {
  const uses = collectProofIdentifierUses()
  for (const [method, expectedFiles] of Object.entries(
    EXPECTED_PROOF_IDENTIFIER_FILES,
  )) {
    const actualFiles = [
      ...new Set(
        uses.filter((use) => use.method === method).map((use) => use.file),
      ),
    ].sort()
    expect(actualFiles).toEqual([...expectedFiles].sort())
  }

  const actualCounts = Object.fromEntries(
    [...new Set(uses.map((use) => `${use.file}:${use.method}`))]
      .sort()
      .map((key) => [
        key,
        uses.filter((use) => `${use.file}:${use.method}` === key).length,
      ]),
  )
  expect(actualCounts).toEqual(EXPECTED_PROOF_IDENTIFIER_COUNTS)
})

test("keeps conditional updateUser calls password-only at their exact current sites", () => {
  const calls = collectAuthCalls().filter(
    (call) => call.method === "auth.updateUser",
  )
  expect(calls.map((call) => call.file).sort()).toEqual(
    [...EXPECTED_PASSWORD_ONLY_UPDATE_CALLS].sort(),
  )

  for (const call of calls) {
    expect(call.node.arguments).toHaveLength(1)
    const names = objectPropertyNames(call.node.arguments[0])
    expect(names).not.toBeNull()
    expect(names).not.toContain("email")
    expect(names?.every((name) => name === "data" || name === "password")).toBe(
      true,
    )
  }
})

test("forbids direct email-proof REST endpoints everywhere in application source", () => {
  const violations = sourceFiles(SOURCE_ROOT)
    .map((absolutePath) => ({
      file: relative(ROOT, absolutePath).replaceAll("\\", "/"),
      source: readFileSync(absolutePath, "utf8"),
    }))
    .filter(({ source }) => DIRECT_EMAIL_PROOF_ENDPOINT.test(source))
    .map(({ file }) => file)
    .sort()

  expect(violations).toEqual([])
})
