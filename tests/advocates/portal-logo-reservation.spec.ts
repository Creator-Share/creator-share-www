import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ReservationModule =
  typeof import("../../src/lib/advocates/admin/logoReservation")
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
  resolve(process.cwd(), "tests/advocates/portal-logo-reservation.spec.ts"),
)
const reservation = testRequire(
  "../../src/lib/advocates/admin/logoReservation",
) as ReservationModule
nodeModule._load = originalModuleLoad

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const ACTOR_ID = "33333333-3333-4333-8333-333333333333"
const REQUEST_ID = "44444444-4444-4444-8444-444444444444"
const OBJECT_PATH = `logos/hope/${RESERVATION_ID}.webp`

test.describe("advocate logo reservation application boundary", () => {
  test("parses only the exact tenant-bound reservation contract", () => {
    expect(
      reservation.parseAdvocateLogoUploadReservation(
        [
          {
            reservation_id: RESERVATION_ID,
            object_path: OBJECT_PATH,
            expires_at: "2026-07-19T00:00:00.000Z",
          },
        ],
        "hope",
      ),
    ).toEqual({
      reservationId: RESERVATION_ID,
      objectPath: OBJECT_PATH,
      expiresAt: "2026-07-19T00:00:00.000Z",
    })

    for (const value of [
      [],
      [{ reservation_id: RESERVATION_ID, object_path: OBJECT_PATH }],
      [
        {
          reservation_id: RESERVATION_ID,
          object_path: `logos/other/${RESERVATION_ID}.webp`,
          expires_at: "2026-07-19T00:00:00.000Z",
        },
      ],
      [
        {
          reservation_id: RESERVATION_ID,
          object_path: OBJECT_PATH,
          expires_at: "invalid",
          sponsor_email: "must-not-cross@example.test",
        },
      ],
    ]) {
      expect(
        reservation.parseAdvocateLogoUploadReservation(value, "hope"),
      ).toBeNull()
    }
  })

  test("accepts only coherent immutable reservation outcomes", () => {
    expect(
      reservation.parseAdvocateLogoUploadReservationResult(
        [
          {
            status: "attached",
            object_path: OBJECT_PATH,
            expected_version: 7,
            resulting_version: 8,
          },
        ],
        { reservationId: RESERVATION_ID, slug: "hope" },
      ),
    ).toEqual({
      status: "attached",
      objectPath: OBJECT_PATH,
      expectedVersion: 7,
      resultingVersion: 8,
    })

    for (const row of [
      {
        status: "attached",
        object_path: OBJECT_PATH,
        expected_version: 7,
        resulting_version: 9,
      },
      {
        status: "pending",
        object_path: OBJECT_PATH,
        expected_version: 7,
        resulting_version: 8,
      },
      {
        status: "unknown",
        object_path: OBJECT_PATH,
        expected_version: 7,
        resulting_version: null,
      },
    ]) {
      expect(
        reservation.parseAdvocateLogoUploadReservationResult([row], {
          reservationId: RESERVATION_ID,
          slug: "hope",
        }),
      ).toBeNull()
    }
  })

  test("maps stable database outcomes without exposing provider details", () => {
    expect(reservation.classifyAdvocateLogoReservationFailure("40001")).toEqual(
      { status: 409, code: "version_conflict" },
    )
    expect(reservation.classifyAdvocateLogoReservationFailure("55000")).toEqual(
      { status: 409, code: "upload_in_progress" },
    )
    expect(reservation.classifyAdvocateLogoReservationFailure("55P03")).toEqual(
      { status: 409, code: "upload_in_progress" },
    )
    expect(reservation.classifyAdvocateLogoReservationFailure("54000")).toEqual(
      { status: 429, code: "rate_limited" },
    )
    expect(
      reservation.classifyAdvocateLogoReservationFailure(undefined),
    ).toEqual({ status: 500, code: "logo_update_failed" })
  })

  test("uses only the narrow service RPC contracts", async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, input: Record<string, unknown>) {
        calls.push({ name, input })
        if (name === "reserve_advocate_logo_upload") {
          return {
            data: [
              {
                reservation_id: RESERVATION_ID,
                object_path: OBJECT_PATH,
                expires_at: "2026-07-19T00:00:00.000Z",
              },
            ],
            error: null,
          }
        }
        if (name === "settle_advocate_logo_upload_reservation") {
          return { data: "cancelled", error: null }
        }
        return {
          data: [
            {
              status: "cancelled",
              object_path: OBJECT_PATH,
              expected_version: 7,
              resulting_version: null,
            },
          ],
          error: null,
        }
      },
    } as never

    await reservation.reserveAdvocateLogoUpload(client, {
      advocateId: ADVOCATE_ID,
      actorUserId: ACTOR_ID,
      expectedVersion: 7,
      slug: "hope",
      requestId: REQUEST_ID,
      traceId: "trace",
    })
    await reservation.settleAdvocateLogoUploadReservation(client, {
      reservationId: RESERVATION_ID,
      actorUserId: ACTOR_ID,
      requestId: REQUEST_ID,
      status: "cancelled",
      failureCode: "invalid_source",
    })
    await reservation.getAdvocateLogoUploadReservationResult(client, {
      reservationId: RESERVATION_ID,
      actorUserId: ACTOR_ID,
      requestId: REQUEST_ID,
      slug: "hope",
    })

    expect(calls).toEqual([
      {
        name: "reserve_advocate_logo_upload",
        input: {
          target_advocate_id: ADVOCATE_ID,
          target_actor_user_id: ACTOR_ID,
          expected_advocate_version: 7,
          request_id: REQUEST_ID,
          trace_id: "trace",
        },
      },
      {
        name: "settle_advocate_logo_upload_reservation",
        input: {
          target_reservation_id: RESERVATION_ID,
          target_actor_user_id: ACTOR_ID,
          request_id: REQUEST_ID,
          target_status: "cancelled",
          failure_code: "invalid_source",
        },
      },
      {
        name: "get_advocate_logo_upload_reservation_result",
        input: {
          target_reservation_id: RESERVATION_ID,
          target_actor_user_id: ACTOR_ID,
          request_id: REQUEST_ID,
        },
      },
    ])
  })
})
