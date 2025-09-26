import { createClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { Expense } from "@/types/admin.types"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const body: Expense = await request.json()

    // Validate required fields
    if (!body.name || !body.description || body.price === undefined) {
      return NextResponse.json(
        { error: "Name, description, and price are required" },
        { status: 400 },
      )
    }

    const { data: expense, error } = await supabase
      .from("expenses")
      .insert([
        {
          name: body.name,
          description: body.description,
          price: body.price,
          icon: body.icon || null,
          organization_id: body.organization_id || null,
        },
      ])
      .select()
      .single()

    if (error) {
      console.error("Error creating expense:", error)
      return NextResponse.json(
        { error: "Failed to create expense" },
        { status: 500 },
      )
    }

    return NextResponse.json(expense)
  } catch (error) {
    console.error("Error in expenses POST:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
