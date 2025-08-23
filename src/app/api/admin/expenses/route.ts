import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { Expense } from '@/types/admin.types';

export async function GET() {
  try {
    const supabase = await createClient();
    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: adminCheck } = await supabase
      .from('role_assignments')
      .select('role_id')
      .eq('user_id', user.id)
      .single();

    if (!adminCheck) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: expenses, error } = await supabase
      .from('expenses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching expenses:', error);
      return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
    }

    return NextResponse.json(expenses);
  } catch (error) {
    console.error('Error in expenses GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const body: Expense = await request.json();
    
    // Validate required fields
    if (!body.name || !body.description || body.price === undefined) {
      return NextResponse.json({ error: 'Name, description, and price are required' }, { status: 400 });
    }

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert([{
        name: body.name,
        description: body.description,
        price: body.price,
        icon: body.icon || null,
        organization_id: body.organization_id || null
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating expense:', error);
      return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
    }

    return NextResponse.json(expense);
  } catch (error) {
    console.error('Error in expenses POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 