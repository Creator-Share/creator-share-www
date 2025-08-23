import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from 'next/server';
import { Expense } from '@/types/admin.types';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    
    const body: Expense = await request.json();
    
    // Validate required fields
    if (!body.name || !body.description || body.price === undefined) {
      return NextResponse.json({ error: 'Name, description, and price are required' }, { status: 400 });
    }

    const { data: expense, error } = await supabase
      .from('expenses')
      .update({
        name: body.name,
        description: body.description,
        price: body.price,
        icon: body.icon || null,
        organization_id: body.organization_id || null
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating expense:', error);
      return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 });
    }

    return NextResponse.json(expense);
  } catch (error) {
    console.error('Error in expense PUT:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    console.log('Deleting expense with ID:', id);

    // First, check if the expense exists
    const { data: existingExpense, error: checkError } = await supabase
      .from('expenses')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existingExpense) {
      console.error('Expense not found:', id);
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    }

    // Delete the expense (this should cascade to expense_assignments)
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting expense:', error);
      return NextResponse.json({ error: `Failed to delete expense: ${error.message}` }, { status: 500 });
    }

    console.log('Expense deleted successfully');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in expense DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 