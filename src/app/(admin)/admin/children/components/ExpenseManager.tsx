"use client"
import React, { useState, useEffect, useCallback } from "react"
import { Box, Button, Text, Input, Textarea } from "@chakra-ui/react"
import { Field } from "@/components/ui/field"
import { toaster } from "@/components/ui/toaster"
import { Expense, ExpenseAssignment } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"

interface ExpenseManagerProps {
  beneficiaryId?: string
  onExpensesChange?: (expenses: ExpenseAssignment[]) => void
  budgetGoal?: number // Add budget goal prop
}

const ExpenseManager: React.FC<ExpenseManagerProps> = ({
  beneficiaryId,
  onExpensesChange,
  budgetGoal = 0,
}) => {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [assignments, setAssignments] = useState<ExpenseAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    name: "",
    description: "",
    price: 0,
    icon: "",
  })

  // Calculate budget metrics
  const totalAssignedExpenses = assignments.reduce((total, assignment) => {
    const expense =
      assignment.expenses ||
      expenses.find((e) => e.id === assignment.expense_id)
    return total + (expense?.price || 0)
  }, 0)

  const remainingBudget = budgetGoal - totalAssignedExpenses
  const budgetUsedPercentage =
    budgetGoal > 0 ? (totalAssignedExpenses / budgetGoal) * 100 : 0

  const fetchAssignments = useCallback(async () => {
    if (!beneficiaryId) return

    try {
      const response = await fetch(
        `/api/admin/expense-assignments/get?beneficiary_id=${beneficiaryId}`,
      )
      if (response.ok) {
        const data = await response.json()
        setAssignments(data)
        onExpensesChange?.(data)
      }
    } catch (error) {
      console.error("Error fetching assignments:", error)
    }
  }, [beneficiaryId, onExpensesChange])

  // Fetch all available expenses
  useEffect(() => {
    fetchExpenses()
  }, [])

  // Fetch assignments for this beneficiary
  useEffect(() => {
    if (beneficiaryId) {
      fetchAssignments()
    }
  }, [beneficiaryId, fetchAssignments])

  const fetchExpenses = async () => {
    try {
      const response = await fetch("/api/admin/expenses/get")
      if (response.ok) {
        const data = await response.json()
        setExpenses(data)
      }
    } catch (error) {
      console.error("Error fetching expenses:", error)
    }
  }

  const createExpense = async () => {
    if (
      !newExpense.name ||
      !newExpense.description ||
      newExpense.price === undefined
    ) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      })
      return
    }

    const expensePrice = Number(newExpense.price || 0) * 100

    // Check if this expense would exceed the budget
    if (budgetGoal > 0 && totalAssignedExpenses + expensePrice > budgetGoal) {
      toaster.create({
        title: "Budget Exceeded",
        description: `This expense would exceed the budget goal of $${centsToDollars(budgetGoal)}. You have $${centsToDollars(remainingBudget)} remaining.`,
        duration: 5000,
      })
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/admin/expenses/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...newExpense,
          price: expensePrice,
        }),
      })

      if (response.ok) {
        const createdExpense = await response.json()
        setExpenses((prev) => [createdExpense, ...prev])
        setNewExpense({ name: "", description: "", price: 0, icon: "" })
        setShowCreateForm(false)

        // Auto-assign the expense to the beneficiary if beneficiaryId exists
        if (beneficiaryId) {
          await assignExpense(createdExpense.id)
        }

        toaster.create({
          title: "Success",
          description: "Expense created successfully",
          duration: 5000,
        })
      } else {
        const error = await response.json()
        toaster.create({
          title: "Error",
          description: error.error || "Failed to create expense",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error creating expense:", error)
      toaster.create({
        title: "Error",
        description: "Failed to create expense",
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  const assignExpense = async (expenseId: string) => {
    if (!beneficiaryId) return

    const expense = expenses.find((e) => e.id === expenseId)
    if (!expense) return

    // Check if this assignment would exceed the budget
    if (budgetGoal > 0 && totalAssignedExpenses + expense.price > budgetGoal) {
      toaster.create({
        title: "Budget Exceeded",
        description: `This expense would exceed the budget goal of $${centsToDollars(budgetGoal)}. You have $${centsToDollars(remainingBudget)} remaining.`,
        duration: 5000,
      })
      return
    }

    try {
      const response = await fetch("/api/admin/expense-assignments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          beneficiary_id: beneficiaryId,
          expense_id: expenseId,
          weight: 1,
          fulfilled: false,
          onetime_expense: false,
        }),
      })

      if (response.ok) {
        const assignment = await response.json()
        setAssignments((prev) => [...prev, assignment])
        onExpensesChange?.([...assignments, assignment])
        toaster.create({
          title: "Success",
          description: "Expense assigned successfully",
          duration: 5000,
        })
      } else {
        const error = await response.json()
        toaster.create({
          title: "Error",
          description: error.error || "Failed to assign expense",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error assigning expense:", error)
      toaster.create({
        title: "Error",
        description: "Failed to assign expense",
        duration: 5000,
      })
    }
  }

  const removeAssignment = async (assignmentId: string) => {

    try {
      const assignment = assignments.find((a) => a.id === assignmentId)
      if (!assignment) {
        toaster.create({
          title: "Error",
          description: "Assignment not found",
          duration: 5000,
        })
        return
      }
      
      const response = await fetch(
        `/api/admin/expenses/delete/${assignment.expense_id}`,
        {
          method: "DELETE",
        },
      )

      if (response.ok) {
        // Update local state - remove the assignment
        const updatedAssignments = assignments.filter(
          (a) => a.id !== assignmentId,
        )
        setAssignments(updatedAssignments)

        // Also remove the expense from the available expenses list
        setExpenses((prev) =>
          prev.filter((e) => e.id !== assignment.expense_id),
        )

        // Notify parent component with updated assignments
        onExpensesChange?.(updatedAssignments)


        toaster.create({
          title: "Success",
          description: "Expense permanently deleted",
          duration: 5000,
        })
      } else {
        // Handle API error
        const errorText = await response.text()
        console.error("API error response:", errorText)

        let errorMessage = "Failed to delete expense"
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorMessage
        } catch {
          // If it's not JSON, use the text as is
          errorMessage = errorText || errorMessage
        }

        toaster.create({
          title: "Error",
          description: errorMessage,
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error removing assignment:", error)
      toaster.create({
        title: "Error",
        description: "Failed to delete expense",
        duration: 5000,
      })
    }
  }

  return (
    <Box className="space-y-4">
      <Text className="text-lg font-semibold">Expense Management</Text>

      {/* Budget Summary */}
      {budgetGoal > 0 && (
        <Box className="border rounded-lg p-4 bg-gray-50">
          <Text className="font-medium mb-2">Budget Summary</Text>
          <Box className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <Box>
              <Text className="text-gray-600">Budget Goal</Text>
              <Text className="font-semibold text-lg">
                ${centsToDollars(budgetGoal)}
              </Text>
            </Box>
            <Box>
              <Text className="text-gray-600">Assigned Expenses</Text>
              <Text className="font-semibold text-lg text-blue-600">
                ${centsToDollars(totalAssignedExpenses)}
              </Text>
            </Box>
            <Box>
              <Text className="text-gray-600">Remaining</Text>
              <Text
                className={`font-semibold text-lg ${remainingBudget < 0 ? "text-red-600" : "text-green-600"}`}
              >
                ${centsToDollars(remainingBudget)}
              </Text>
            </Box>
          </Box>

          {/* Budget Progress Bar */}
          <Box className="mt-3">
            <Box className="flex justify-between text-xs text-gray-600 mb-1">
              <Text>Budget Usage</Text>
              <Text>{budgetUsedPercentage.toFixed(1)}%</Text>
            </Box>
            <Box className="w-full bg-gray-200 rounded-full h-2">
              <Box
                className={`h-2 rounded-full transition-all duration-300 ${
                  budgetUsedPercentage > 100
                    ? "bg-red-500"
                    : budgetUsedPercentage > 80
                      ? "bg-yellow-500"
                      : "bg-green-500"
                }`}
                style={{ width: `${Math.min(budgetUsedPercentage, 100)}%` }}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Create New Expense */}
      <Box className="border rounded-lg p-4">
        <Box className="flex items-center justify-between mb-4">
          <Text className="font-medium">Expenses</Text>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-[#1C3C8C] text-white"
            size="sm"
            disabled={budgetGoal > 0 && remainingBudget <= 0}
            p={4}
          >
            {showCreateForm ? "Cancel" : "Create New Expense"}
          </Button>
        </Box>

        {budgetGoal > 0 && remainingBudget <= 0 && (
          <Box className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <Text className="text-yellow-800 text-sm">
              ⚠️ Budget limit reached. You cannot create more expenses.
            </Text>
          </Box>
        )}

        {showCreateForm && (
          <Box className="space-y-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <Field label="Expense Name" required>
              <Input
                value={newExpense.name}
                onChange={(e) =>
                  setNewExpense((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g., School Supplies"
                className="border"
                px={2}
              />
            </Field>
            <Field label="Description" required>
              <Textarea
                value={newExpense.description}
                onChange={(e) =>
                  setNewExpense((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Describe what this expense covers"
                className="border"
                p={2}
              />
            </Field>
            <Field label="Price (USD)" required>
              <Input
                type="number"
                value={newExpense.price || ""}
                onChange={(e) =>
                  setNewExpense((prev) => ({
                    ...prev,
                    price:
                      e.target.value === ""
                        ? undefined
                        : parseFloat(e.target.value) || 0,
                  }))
                }
                placeholder="0.00"
                className="border"
                px={2}
              />
            </Field>
            <Field label="Icon (optional)">
              <Input
                value={newExpense.icon}
                onChange={(e) =>
                  setNewExpense((prev) => ({ ...prev, icon: e.target.value }))
                }
                placeholder="e.g., 📚, 🎒"
                className="border"
                px={2}
              />
            </Field>

            {/* Price validation warning */}
            {budgetGoal > 0 &&
              newExpense.price !== undefined &&
              newExpense.price !== 0 &&
              Number(newExpense.price) > 0 && (
                <Box
                  className={`p-3 rounded-lg text-sm font-medium ${
                    totalAssignedExpenses + Number(newExpense.price) * 100 >
                    budgetGoal
                      ? "bg-red-100 text-red-800 border-2 border-red-300"
                      : "bg-green-100 text-green-800 border-2 border-green-300"
                  }`}
                >
                  <Box className="flex items-center gap-2">
                    <Text className="text-lg">
                      {totalAssignedExpenses + Number(newExpense.price) * 100 >
                      budgetGoal
                        ? "⚠️"
                        : "✅"}
                    </Text>
                    <Text>
                      {`This expense will use $${newExpense.price.toFixed(2)} of your remaining $${centsToDollars(remainingBudget)} budget.`}
                      {totalAssignedExpenses + Number(newExpense.price) * 100 >
                        budgetGoal && ` ⚠️ This will EXCEED your budget goal!`}
                    </Text>
                  </Box>
                </Box>
              )}

            <Button
              onClick={createExpense}
              disabled={
                loading ||
                (budgetGoal > 0 &&
                  totalAssignedExpenses + Number(newExpense.price || 0) * 100 >
                    budgetGoal)
              }
              className="bg-[#1C3C8C] text-white disabled:opacity-50"
              p={4}
            >
              {loading ? "Creating..." : "Create Expense"}
            </Button>
          </Box>
        )}

        {/* Assigned Expenses List */}
        {assignments.length > 0 && (
          <Box className="space-y-2">
            {assignments.map((assignment) => {
              const expense =
                assignment.expenses ||
                expenses.find((e) => e.id === assignment.expense_id)
              return (
                <Box
                  key={assignment.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-blue-50"
                >
                  <Box className="flex items-center gap-3">
                    {expense?.icon && (
                      <Text className="text-xl">{expense.icon}</Text>
                    )}
                    <Box>
                      <Text className="font-medium">
                        {expense?.name || "Unknown Expense"}
                      </Text>
                      <Text className="text-sm text-gray-600">
                        {expense?.description || "No description"}
                      </Text>
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
              )
            })}
          </Box>
        )}

        {assignments.length === 0 && (
          <Box className="text-center py-8 text-gray-500">
            <Text>
              No expenses assigned yet. Create your first expense to get
              started.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default ExpenseManager
