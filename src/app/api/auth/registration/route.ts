import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const { email, password, first_name, last_name } = body;

  if (!email || !password || !first_name || !last_name) {
    return NextResponse.json(
      { error: 'Email, password, first name, and last name are required' },
      { status: 400 }
    );
  }

  try {
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name,
          last_name,
        },
        emailRedirectTo: `http://localhost:3000/main/onboarding`,
      },
    });

    if (signUpError || !signUpData) {
      return NextResponse.json(
        { error: signUpError?.message || 'Registration failed' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        message: 'Registration successful! Please check your email for confirmation.',
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unexpected error occurred';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
