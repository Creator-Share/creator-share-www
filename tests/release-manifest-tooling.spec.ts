import { spawnSync } from "node:child_process"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

const workspace = process.cwd()

test("the offline lane is deterministic and cannot consult the npm registry", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(workspace, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> }
  expect(packageJson.scripts["test:lane:offline"]).toContain("--workers=1")
  expect(packageJson.scripts["test:lane:offline"]).toContain("--retries=0")

  const temporaryWorkspace = await mkdtemp(
    resolve(tmpdir(), "release-lane-runner-"),
  )
  try {
    await mkdir(resolve(temporaryWorkspace, "scripts"), { recursive: true })
    await mkdir(resolve(temporaryWorkspace, "tests"), { recursive: true })
    await mkdir(
      resolve(temporaryWorkspace, "node_modules/@playwright/test"),
      { recursive: true },
    )
    await cp(
      resolve(workspace, "scripts/run-release-lane.mjs"),
      resolve(temporaryWorkspace, "scripts/run-release-lane.mjs"),
    )
    await writeFile(
      resolve(temporaryWorkspace, "tests/release-manifest.json"),
      JSON.stringify({
        lanes: {
          "offline-playwright": {
            description: "isolated runner proof",
            env: { RUNNER_SENTINEL: "present" },
            files: ["tests/example.spec.ts"],
            required: true,
            runner: "playwright",
          },
        },
      }),
    )
    await writeFile(
      resolve(temporaryWorkspace, "node_modules/@playwright/test/cli.js"),
      [
        'import { writeFileSync } from "node:fs"',
        "writeFileSync(",
        "  process.env.RUNNER_EVIDENCE_PATH,",
        "  JSON.stringify({ args: process.argv.slice(2), sentinel: process.env.RUNNER_SENTINEL }),",
        ")",
      ].join("\n"),
    )
    const evidencePath = resolve(temporaryWorkspace, "evidence.json")
    const result = spawnSync(
      process.execPath,
      [
        resolve(temporaryWorkspace, "scripts/run-release-lane.mjs"),
        "offline-playwright",
        "--workers=1",
      ],
      {
        cwd: temporaryWorkspace,
        encoding: "utf8",
        env: { ...process.env, RUNNER_EVIDENCE_PATH: evidencePath },
      },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toEqual({
      args: ["test", "tests/example.spec.ts", "--workers=1"],
      sentinel: "present",
    })
  } finally {
    await rm(temporaryWorkspace, { recursive: true, force: true })
  }
})

test("the manifest distinguishes required tests from optional canaries and support modules", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(workspace, "tests/release-manifest.json"), "utf8"),
  ) as {
    lanes: Record<string, { required: boolean }>
  }

  for (const lane of Object.values(manifest.lanes)) {
    expect(typeof lane.required).toBe("boolean")
  }
  expect(manifest.lanes["database-harness"].required).toBe(true)
  expect(manifest.lanes["opt-in-integration"].required).toBe(false)
  expect(manifest.lanes["provider-canary"].required).toBe(false)
  expect(manifest.lanes["harness-support"].required).toBe(false)
})


test("the required publication gate rejects any incomplete application or database job", async () => {
  const testRequire = createRequire(resolve(workspace, "package.json"))
  const { load } = testRequire("js-yaml") as { load(source: string): unknown }
  const workflow = load(
    await readFile(
      resolve(workspace, ".github/workflows/advocate-publication-db-gate.yml"),
      "utf8",
    ),
  ) as {
    jobs: Record<string, {
      name: string
      needs?: string[]
      if?: string
      steps: Array<{ run?: string; env?: Record<string, string> }>
    }>
  }
  const jobs = workflow.jobs
  expect(jobs["application-contracts"].needs).toBeUndefined()
  expect(jobs["database-contracts"].needs).toBeUndefined()
  const gate = jobs["publication-authority"]
  expect(gate.name).toBe("Publication authority database tests")
  expect(gate.needs).toEqual(["application-contracts", "database-contracts"])
  expect(gate.if).toBe("${{ always() }}")
  expect(gate.steps).toHaveLength(1)
  expect(gate.steps[0].env).toEqual({
    APPLICATION_RESULT: "${{ needs.application-contracts.result }}",
    DATABASE_RESULT: "${{ needs.database-contracts.result }}",
  })

  // Run the actual gate shell with GitHub's fail-fast bash behavior. A skipped
  // or cancelled prerequisite must never turn the required check green.
  const outcomes = ["success", "failure", "skipped", "cancelled"]
  for (const application of outcomes) {
    for (const database of outcomes) {
      const result = spawnSync("bash", ["-e", "-c", gate.steps[0].run!], {
        encoding: "utf8",
        env: {
          ...process.env,
          APPLICATION_RESULT: application,
          DATABASE_RESULT: database,
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status === 0, `${application}, ${database}`).toBe(
        application === "success" && database === "success",
      )
    }
  }
})
