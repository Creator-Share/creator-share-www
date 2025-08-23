"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Box, Button, Text, Input, Textarea } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { toaster } from "@/components/ui/toaster";
import { Expense, ExpenseAssignment } from "@/types/admin.types";
import { centsToDollars, dollarsToCents } from "@/utils/currency";

interface ExpenseManagerProps {
  beneficiaryId?: string;
  onExpensesChange?: (expenses: ExpenseAssignment[]) => void;
}

const ExpenseManager: React.FC<ExpenseManagerProps> = ({ beneficiaryId, onExpensesChange }) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [assignments, setAssignments] = useState<ExpenseAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    name: "",
    description: "",
    price: 0,
    icon: ""
  });

  const fetchAssignments = useCallback(async () => {
    if (!beneficiaryId) return;
    
    try {
      const response = await fetch(`/api/admin/expense-assignments/get?beneficiary_id=${beneficiaryId}`);
      if (response.ok) {
        const data = await response.json();
        setAssignments(data);
        onExpensesChange?.(data);
      }
    } catch (error) {
      console.error('Error fetching assignments:', error);
    }
  }, [beneficiaryId, onExpensesChange]);

  // Fetch all available expenses
  useEffect(() => {
    fetchExpenses();
  }, []);

  // Fetch assignments for this beneficiary
  useEffect(() => {
    if (beneficiaryId) {
      fetchAssignments();
    }
  }, [beneficiaryId, fetchAssignments]);

  const fetchExpenses = async () => {
    try {
      const response = await fetch('/api/admin/expenses/get');
      if (response.ok) {
        const data = await response.json();
        setExpenses(data);
      }
    } catch (error) {
      console.error('Error fetching expenses:', error);
    }
  };

  const createExpense = async () => {
    if (!newExpense.name || !newExpense.description || newExpense.price === undefined) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/admin/expenses/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...newExpense,
          price: dollarsToCents(newExpense.price || 0)
        }),
      });

      if (response.ok) {
        const createdExpense = await response.json();
        setExpenses(prev => [createdExpense, ...prev]);
        setNewExpense({ name: "", description: "", price: 0, icon: "" });
        setShowCreateForm(false);

        // Auto-assign the expense to the beneficiary if beneficiaryId exists
        if (beneficiaryId) {
          await assignExpense(createdExpense.id);
        }

        toaster.create({
          title: "Success",
          description: "Expense created successfully",
          duration: 5000,
        });
      } else {
        const error = await response.json();
        toaster.create({
          title: "Error",
          description: error.error || "Failed to create expense",
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Error creating expense:', error);
      toaster.create({
        title: "Error",
        description: "Failed to create expense",
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const assignExpense = async (expenseId: string) => {
    if (!beneficiaryId) return;

    try {
      const response = await fetch('/api/admin/expense-assignments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          beneficiary_id: beneficiaryId,
          expense_id: expenseId,
          weight: 1,
          fulfilled: false,
          onetime_expense: false
        }),
      });

      if (response.ok) {
        const assignment = await response.json();
        setAssignments(prev => [...prev, assignment]);
        onExpensesChange?.([...assignments, assignment]);
        toaster.create({
          title: "Success",
          description: "Expense assigned successfully",
          duration: 5000,
        });
      } else {
        const error = await response.json();
        toaster.create({
          title: "Error",
          description: error.error || "Failed to assign expense",
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Error assigning expense:', error);
      toaster.create({
        title: "Error",
        description: "Failed to assign expense",
        duration: 5000,
      });
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    console.log('Removing assignment with ID:', assignmentId);
    
    try {
      // First, get the assignment to find the expense_id
      const assignment = assignments.find(a => a.id === assignmentId);
      if (!assignment) {
        toaster.create({
          title: "Error",
          description: "Assignment not found",
          duration: 5000,
        });
        return;
      }

      console.log('Found assignment:', assignment);
      console.log('Will delete expense with ID:', assignment.expense_id);

      // Delete the expense from the expenses table (this will cascade to assignments)
      const response = await fetch(`/api/admin/expenses/delete/${assignment.expense_id}`, {
        method: 'DELETE',
      });

      console.log('Delete response status:', response.status);
      console.log('Delete response ok:', response.ok);

      if (response.ok) {
        // Update local state - remove the assignment
        const updatedAssignments = assignments.filter(a => a.id !== assignmentId);
        setAssignments(updatedAssignments);
        
        // Also remove the expense from the available expenses list
        setExpenses(prev => prev.filter(e => e.id !== assignment.expense_id));
        
        // Notify parent component with updated assignments
        onExpensesChange?.(updatedAssignments);
        
        console.log('Expense and assignment removed successfully');
        
        toaster.create({
          title: "Success",
          description: "Expense permanently deleted",
          duration: 5000,
        });
      } else {
        // Handle API error
        const errorText = await response.text();
        console.error('API error response:', errorText);
        
        let errorMessage = "Failed to delete expense";
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
        } catch {
          // If it's not JSON, use the text as is
          errorMessage = errorText || errorMessage;
        }
        
        toaster.create({
          title: "Error",
          description: errorMessage,
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Error removing assignment:', error);
      toaster.create({
        title: "Error",
        description: "Failed to delete expense",
        duration: 5000,
      });
    }
  };

  return (
    <Box className="space-y-4">
      <Text className="text-lg font-semibold">Expense Management</Text>
      
      {/* Create New Expense */}
      <Box className="border rounded-lg p-4">
        <Box className="flex items-center justify-between mb-4">
          <Text className="font-medium">Expenses</Text>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-[#1C3C8C] text-white"
            size="sm"
          >
            {showCreateForm ? "Cancel" : "Create New Expense"}
          </Button>
        </Box>

        {showCreateForm && (
          <Box className="space-y-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <Field label="Expense Name" required>
              <Input
                value={newExpense.name}
                onChange={(e) => setNewExpense(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., School Supplies"
                className="border"
              />
            </Field>
            <Field label="Description" required>
              <Textarea
                value={newExpense.description}
                onChange={(e) => setNewExpense(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe what this expense covers"
                className="border"
              />
            </Field>
            <Field label="Price (USD)" required>
              <Input
                type="number"
                value={newExpense.price}
                onChange={(e) => setNewExpense(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                placeholder="0.00"
                className="border"
              />
            </Field>
            <Field label="Icon (optional)">
              <Input
                value={newExpense.icon}
                onChange={(e) => setNewExpense(prev => ({ ...prev, icon: e.target.value }))}
                placeholder="e.g., 📚, 🎒"
                className="border"
              />
            </Field>
            <Button
              onClick={createExpense}
              disabled={loading}
              className="bg-[#1C3C8C] text-white"
            >
              {loading ? "Creating..." : "Create Expense"}
            </Button>
          </Box>
        )}

        {/* Assigned Expenses List */}
        {assignments.length > 0 && (
          <Box className="space-y-2">
            {assignments.map((assignment) => {
              const expense = assignment.expenses || expenses.find(e => e.id === assignment.expense_id);
              return (
                <Box key={assignment.id} className="flex items-center justify-between p-3 border rounded-lg bg-blue-50">
                  <Box className="flex items-center gap-3">
                    {expense?.icon && <Text className="text-xl">{expense.icon}</Text>}
                    <Box>
                      <Text className="font-medium">{expense?.name || 'Unknown Expense'}</Text>
                      <Text className="text-sm text-gray-600">{expense?.description || 'No description'}</Text>
                      <Text className="text-sm font-semibold text-green-600">
                        ${centsToDollars(expense?.price || 0)}
                      </Text>
                    </Box>
                  </Box>
                  <Button
                    onClick={() => removeAssignment(assignment.id!)}
                    className="bg-red-500 text-white"
                    size="sm"
                  >
                    Remove
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}

        {assignments.length === 0 && (
          <Box className="text-center py-8 text-gray-500">
            <Text>No expenses assigned yet. Create your first expense to get started.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ExpenseManager; 