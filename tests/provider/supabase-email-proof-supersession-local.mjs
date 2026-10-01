import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  createLocalSupabaseEmailProofAdapter,
  localSupabaseEmailProofCanaryExitCode,
  runSupabaseEmailProofSupersessionCanary,
  serializeSupabaseEmailProofSupersessionEvidence,
} from "./support/supabase-email-proof-supersession.mjs"

const RUNNER_PATH = fileURLToPath(import.meta.url)
const SUPPORT_PATH = resolve(
  dirname(RUNNER_PATH),
  "support/supabase-email-proof-supersession.mjs",
)
const SHA_REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,47})?$/
const MAXIMUM_LOCAL_FILE_BYTES = 1024 * 1024
const MAXIMUM_LOCAL_KEY_BYTES = 4096
const LOCAL_SUPABASE_ORIGIN = "http://127.0.0.1:54321"
const LOCAL_MAILPIT_ORIGIN = "http://127.0.0.1:54324"
const LOCAL_APPLICATION_ORIGIN = "http://127.0.0.1:3000"
const EVIDENCE_RELATIVE_PATH =
  "test-results/provider/ff029-supabase-email-proof-supersession.json"

function requiredEnvironmentValue(environment, name, minimum, maximum) {
  const value = environment[name]
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new Error(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  return value
}

function boundedDuration(environment, name, fallback, minimum, maximum) {
  const value = environment[name]
  if (value === undefined) return fallback
  if (!/^[0-9]{1,9}$/.test(value)) {
    throw new Error(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  const duration = Number(value)
  if (!Number.isInteger(duration) || duration < minimum || duration > maximum) {
    throw new Error(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  return duration
}

export function readLocalSupabaseEmailProofEnvironment(
  environment = process.env,
) {
  const totalBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_TOTAL_BUDGET_MILLISECONDS",
    240_000,
    60_000,
    600_000,
  )
  const cleanupBudgetMilliseconds = boundedDuration(
    environment,
    "FF029_CLEANUP_BUDGET_MILLISECONDS",
    60_000,
    1_000,
    60_000,
  )
  if (cleanupBudgetMilliseconds >= totalBudgetMilliseconds) {
    throw new Error("ff029_environment_cleanup_reserve_invalid")
  }
  const anonKey = requiredEnvironmentValue(
    environment,
    "FF029_LOCAL_SUPABASE_ANON_KEY",
    20,
    MAXIMUM_LOCAL_KEY_BYTES,
  )
  const serviceRoleKey = requiredEnvironmentValue(
    environment,
    "FF029_LOCAL_SUPABASE_SERVICE_ROLE_KEY",
    20,
    MAXIMUM_LOCAL_KEY_BYTES,
  )
  if (anonKey === serviceRoleKey) {
    throw new Error("ff029_environment_local_keys_not_distinct")
  }
  const sourceRevision = requiredEnvironmentValue(
    environment,
    "FF029_SOURCE_REVISION",
    40,
    64,
  )
  if (
    !SHA_REVISION_PATTERN.test(sourceRevision) ||
    /^0+$/.test(sourceRevision)
  ) {
    throw new Error("ff029_environment_source_revision_invalid")
  }
  return Object.freeze({
    supabaseUrl: LOCAL_SUPABASE_ORIGIN,
    mailpitUrl: LOCAL_MAILPIT_ORIGIN,
    applicationOrigin: LOCAL_APPLICATION_ORIGIN,
    anonKey,
    serviceRoleKey,
    sourceRevision,
    requestTimeoutMilliseconds: boundedDuration(
      environment,
      "FF029_REQUEST_TIMEOUT_MILLISECONDS",
      5_000,
      250,
      30_000,
    ),
    operationTimeoutMilliseconds: boundedDuration(
      environment,
      "FF029_OPERATION_TIMEOUT_MILLISECONDS",
      15_000,
      250,
      60_000,
    ),
    totalBudgetMilliseconds,
    cleanupBudgetMilliseconds,
  })
}

async function boundedTextFile(path, code) {
  const value = await readFile(path, "utf8")
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_LOCAL_FILE_BYTES) {
    throw new Error(code)
  }
  return value
}

function sha256(parts) {
  const hash = createHash("sha256")
  for (const part of parts) hash.update(part)
  return hash.digest("hex")
}

async function readInstalledCliVersion(repositoryRoot) {
  const packageJson = JSON.parse(
    await boundedTextFile(
      resolve(repositoryRoot, "node_modules/supabase/package.json"),
      "ff029_cli_metadata_invalid",
    ),
  )
  if (
    packageJson?.name !== "supabase" ||
    !VERSION_PATTERN.test(packageJson.version ?? "")
  ) {
    throw new Error("ff029_cli_metadata_invalid")
  }
  return packageJson.version
}

function templatePathFromSection(configSource, sectionName) {
  const escapedSection = sectionName.replaceAll(".", "\\.")
  const section = configSource.match(
    new RegExp(
      `^\\[${escapedSection}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
      "m",
    ),
  )?.[1]
  const matches = section
    ? [...section.matchAll(/^content_path\s*=\s*"([^"]+)"\s*$/gm)]
    : []
  if (matches.length !== 1) {
    throw new Error("ff029_email_template_configuration_invalid")
  }
  return matches[0][1]
}

function activeEmailTemplatePath(configSource, repositoryRoot) {
  const confirmationPath = templatePathFromSection(
    configSource,
    "auth.email.template.confirmation",
  )
  const magicLinkPath = templatePathFromSection(
    configSource,
    "auth.email.template.magic_link",
  )
  if (confirmationPath !== magicLinkPath) {
    throw new Error("ff029_email_template_configuration_invalid")
  }
  const templatePath = resolve(repositoryRoot, confirmationPath)
  const templatesRoot = resolve(repositoryRoot, "supabase/templates")
  const relativeTemplatePath = relative(templatesRoot, templatePath)
  if (
    relativeTemplatePath.length === 0 ||
    relativeTemplatePath.startsWith("..") ||
    relativeTemplatePath.startsWith("/")
  ) {
    throw new Error("ff029_email_template_configuration_invalid")
  }
  return { relativeTemplatePath, templatePath }
}

export async function buildLocalProvenance(configuration, repositoryRoot) {
  if (
    !SHA_REVISION_PATTERN.test(configuration.sourceRevision ?? "") ||
    /^0+$/.test(configuration.sourceRevision)
  ) {
    throw new Error("ff029_source_revision_invalid")
  }
  const configPath = resolve(repositoryRoot, "supabase/config.toml")
  const [supportSource, runnerSource, cliVersion, configSource] =
    await Promise.all([
      boundedTextFile(SUPPORT_PATH, "ff029_harness_source_invalid"),
      boundedTextFile(RUNNER_PATH, "ff029_harness_source_invalid"),
      readInstalledCliVersion(repositoryRoot),
      boundedTextFile(configPath, "ff029_supabase_config_invalid"),
    ])
  const { relativeTemplatePath, templatePath } = activeEmailTemplatePath(
    configSource,
    repositoryRoot,
  )
  const templateSource = await boundedTextFile(
    templatePath,
    "ff029_email_template_invalid",
  )
  return Object.freeze({
    cli_version: cliVersion,
    config_digest: sha256([
      "supabase/config.toml\0",
      configSource,
      `\0supabase/templates/${relativeTemplatePath}\0`,
      templateSource,
    ]),
    repo_revision: configuration.sourceRevision,
    harness_digest: sha256([supportSource, "\0", runnerSource]),
  })
}

export async function runLocalSupabaseEmailProofSupersessionCanary(
  options = {},
) {
  const repositoryRoot = options.repositoryRoot ?? process.cwd()
  const configuration = readLocalSupabaseEmailProofEnvironment(
    options.environment ?? process.env,
  )
  const provenance = await buildLocalProvenance(configuration, repositoryRoot)
  const adapter = await createLocalSupabaseEmailProofAdapter({
    supabaseUrl: configuration.supabaseUrl,
    mailpitUrl: configuration.mailpitUrl,
    applicationOrigin: configuration.applicationOrigin,
    anonKey: configuration.anonKey,
    serviceRoleKey: configuration.serviceRoleKey,
    requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
  })
  return runSupabaseEmailProofSupersessionCanary(adapter, {
    operationTimeoutMilliseconds: configuration.operationTimeoutMilliseconds,
    totalBudgetMilliseconds: configuration.totalBudgetMilliseconds,
    cleanupBudgetMilliseconds: configuration.cleanupBudgetMilliseconds,
    provenance,
  })
}

function unavailableEvidence() {
  return {
    schema_version: 3,
    scope: "local_mechanics_only",
    ff029_status: "open",
    hosted_evidence_required: true,
    local_observation: "unavailable",
    cleanup: "unknown",
    provenance: {
      execution_time_milliseconds: 0,
      started_at: "not_available",
      completed_at: "not_available",
      auth_version: "not_available",
      cli_version: "not_available",
      config_digest: "not_available",
      repo_revision: "not_available",
      harness_digest: "not_available",
    },
    scenario_count: 0,
    scenarios: [],
  }
}

export function localEvidencePath(repositoryRoot = process.cwd()) {
  return resolve(repositoryRoot, EVIDENCE_RELATIVE_PATH)
}

export async function prepareLocalEvidenceTarget(
  repositoryRoot = process.cwd(),
) {
  const targetPath = localEvidencePath(repositoryRoot)
  await mkdir(dirname(targetPath), { recursive: true })
  await rm(targetPath, { force: true })
  return targetPath
}

export async function writeSanitizedLocalEvidence(targetPath, serialized) {
  let parsed
  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    throw new Error("ff029_evidence_serialization_invalid", { cause: error })
  }
  const canonical =
    parsed?.local_observation === "unavailable"
      ? `${JSON.stringify(unavailableEvidence())}\n`
      : serializeSupabaseEmailProofSupersessionEvidence(parsed)
  if (canonical !== serialized) {
    throw new Error("ff029_evidence_serialization_invalid")
  }
  await writeFile(targetPath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  await chmod(targetPath, 0o600)
}

async function main() {
  const repositoryRoot = process.cwd()
  let targetPath
  try {
    targetPath = await prepareLocalEvidenceTarget(repositoryRoot)
  } catch {
    process.stdout.write(`${JSON.stringify(unavailableEvidence())}\n`)
    process.exitCode = 1
    return
  }

  let serialized
  let exitCode = 1
  try {
    const report = await runLocalSupabaseEmailProofSupersessionCanary({
      repositoryRoot,
    })
    serialized = serializeSupabaseEmailProofSupersessionEvidence(report)
    exitCode = localSupabaseEmailProofCanaryExitCode(report)
  } catch {
    serialized = `${JSON.stringify(unavailableEvidence())}\n`
  }

  try {
    await writeSanitizedLocalEvidence(targetPath, serialized)
  } catch {
    exitCode = 1
  }
  process.stdout.write(serialized)
  process.exitCode = exitCode
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
