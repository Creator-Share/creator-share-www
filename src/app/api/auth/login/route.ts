import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  try {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData) {
      return NextResponse.json({ error: signInError?.message || 'Invalid credentials' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData) {
      return NextResponse.json({ error: userError?.message || 'Failed to validate user' }, { status: 401 });
    }

    return NextResponse.json(
      {
        user: userData.user,
        session: signInData.session,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unexpected error occurred';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
