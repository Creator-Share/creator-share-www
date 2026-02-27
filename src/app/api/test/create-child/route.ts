import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Beneficiaries, BeneficiaryType, Status } from "@/types/admin.types"
import { notifyChildCreated } from "@/services/telegram"
import { calculateAge } from "@/utils/ageCalculator"

export async function POST(req: Request) {
  const supabase = await createClient()
  
  try {
    // Parse request body
    const body = await req.json()
    
    // Default test child data
    const defaultChildData = {
      name: "Test Child",
      username: `testchild_${Date.now().toString()}`,
      gender: "Boy" as const,
      birth_date: "2010-01-01",
      biography: "This is a test child created for testing the Telegram bot integration.",
      introduction: "Hello! I'm a test child created to verify the notification system works correctly.",
      budget_goal: 50000, // $500.00 in cents
      budget_raised: 0,
      status: "New" as Status,
      country: "Philippines",
      location_str: "Manila, Philippines",
      location_geo: {
        type: "Point" as const,
        coordinates: [14.5995, 120.9842] as [number, number] // Manila coordinates
      },
      video_url: "",
      beneficiary_type: "CHILD" as BeneficiaryType,
    }

    // Merge with any provided data
    const childData: Partial<Beneficiaries> = {
      ...defaultChildData,
      ...body
    }

    // Ensure required fields
    if (!childData.name) childData.name = defaultChildData.name
    if (!childData.username) childData.username = defaultChildData.username
    if (!childData.gender) childData.gender = defaultChildData.gender
    if (!childData.birth_date) childData.birth_date = defaultChildData.birth_date
    if (!childData.biography) childData.biography = defaultChildData.biography
    if (!childData.introduction) childData.introduction = defaultChildData.introduction
    if (!childData.budget_goal) childData.budget_goal = defaultChildData.budget_goal
    if (!childData.country) childData.country = defaultChildData.country
    if (!childData.location_str) childData.location_str = defaultChildData.location_str
    if (!childData.location_geo) childData.location_geo = defaultChildData.location_geo

    // Insert the child into database
    const { data: inserted, error } = await supabase
      .from("beneficiaries")
      .insert([childData])
      .select()
      .single()

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({ 
        error: error.message,
        details: "Failed to create test child in database"
      }, { status: 400 })
    }

    // Add a test image to the beneficiary for testing purposes
    try {
      // Create a simple test image using a placeholder service
      const testImageUrl = `https://picsum.photos/400/400?random=${Date.now()}`;
      
      // Insert a media record for the test image
      const { error: mediaError } = await supabase
        .from("media")
        .insert([{
          parent_id: inserted.id,
          extension: 'jpg',
          type: 'IMAGE',
          image_url: testImageUrl
        }])
        .select()
        .single();

      if (mediaError) {
        console.warn('Failed to add test image:', mediaError);
      }
    } catch (imageError) {
      console.warn('Error adding test image:', imageError);
    }

    // Send Telegram notification
    try {
      const age = inserted.birth_date ? calculateAge(inserted.birth_date) : null;
      const notificationData = {
        ...inserted,
        age
      };

      await notifyChildCreated(notificationData);
    } catch (telegramError) {
      console.error('Telegram notification error:', telegramError);
      // Don't fail the request if Telegram fails
    }

    return NextResponse.json({ 
      message: "Test child created successfully",
      child: inserted,
      timestamp: new Date().toISOString()
    }, { status: 201 })

  } catch (error) {
    console.error('Test child creation error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Unknown error",
      details: "Failed to create test child"
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Test Child Creation API",
    description: "Create a test child to verify Telegram bot integration",
    usage: {
      method: "POST",
      url: "/api/test/create-child",
      body: {
        optional: {
          name: "Custom child name",
          username: "custom_username",
          gender: "Boy or Girl",
          birth_date: "YYYY-MM-DD",
          biography: "Custom biography",
          introduction: "Custom introduction",
          budget_goal: "number (in cents)",
          country: "Country name",
          location_str: "Location description"
        },
        note: "All fields are optional. Default test data will be used for any missing fields."
      }
    },
    example: {
      curl: "curl -X POST http://localhost:3000/api/test/create-child -H 'Content-Type: application/json' -d '{\"name\":\"John Doe\",\"gender\":\"Boy\"}'"
    }
  })
}