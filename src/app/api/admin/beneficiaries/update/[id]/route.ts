import { NextResponse } from "next/server"
import {
  beneficiaryUpdateRequiresStoredRow,
  findInvalidPublicBeneficiaryProjectionField,
  prepareLegacyPreservingBeneficiaryUpdate,
} from "@/config/beneficiaryValidation"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

const EDITABLE_BENEFICIARY_FIELDS = new Set([
  "name",
  "username",
  "gender",
  "birth_date",
  "biography",
  "budget_goal",
  "status",
  "country",
  "location_geo",
  "location_str",
  "video_url",
  "introduction",
  "metadata",
  "beneficiary_type",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  try {
    const body: unknown = await req.json()
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Invalid beneficiary update" },
        { status: 400 },
      )
    }

    const editableData = Object.fromEntries(
      Object.entries(body).filter(([key]) =>
        EDITABLE_BENEFICIARY_FIELDS.has(key),
      ),
    )

    if (Object.keys(editableData).length === 0) {
      return NextResponse.json(
        { error: "No editable beneficiary fields provided" },
        { status: 400 },
      )
    }

    let storedBeneficiary: Record<string, unknown> | null = null

    if (beneficiaryUpdateRequiresStoredRow(editableData)) {
      const { data: existing, error: readError } = await supabase
        .from("beneficiaries")
        .select()
        .eq("id", id)
        .maybeSingle()
      if (readError || existing === null) {
        console.error("Beneficiary legacy field comparison failed", {
          id,
          code: readError?.code,
        })
        return NextResponse.json(
          { error: "Unable to update beneficiary" },
          { status: readError ? 400 : 404 },
        )
      }
      storedBeneficiary = existing as Record<string, unknown>
    }

    const preparedUpdate = prepareLegacyPreservingBeneficiaryUpdate(
      editableData,
      storedBeneficiary,
    )
    if (!preparedUpdate.ok) {
      return NextResponse.json(
        { error: `Invalid beneficiary ${preparedUpdate.field}` },
        { status: 400 },
      )
    }
    const data = preparedUpdate.data

    const invalidProjectionField =
      findInvalidPublicBeneficiaryProjectionField(data)
    if (invalidProjectionField !== null) {
      return NextResponse.json(
        { error: `Invalid beneficiary ${invalidProjectionField}` },
        { status: 400 },
      )
    }

    if (Object.keys(data).length === 0 && storedBeneficiary !== null) {
      return NextResponse.json(
        { beneficiary: storedBeneficiary },
        { status: 200 },
      )
    }

    const { data: updated, error } = await supabase
      .from("beneficiaries")
      .update(data)
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("Beneficiary update failed", { id, code: error.code })
      return NextResponse.json(
        { error: "Unable to update beneficiary" },
        { status: 400 },
      )
    }

    return NextResponse.json({ beneficiary: updated }, { status: 200 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
