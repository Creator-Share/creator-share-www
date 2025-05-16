import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  const supabase = await createClient()
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  try {
    const { data, error } = await supabase.from('beneficiaries').select('*').eq('id', id).single();
    if (error) {
      throw new Error(error.message || 'Beneficiary not found');
    }
    return NextResponse.json({ child: data }, { status: 200 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unexpected error occurred';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
