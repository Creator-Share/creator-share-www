"use client"
import React, { useEffect, useState } from "react"
import { Box, Button, Text, Input, Textarea } from "@chakra-ui/react"
import { Field } from "@/components/ui/field"
import { toaster } from "@/components/ui/toaster"
import { Expense } from "@/types/admin.types"
import { centsToDollars, dollarsToCents } from "@/utils/currency"
import GoBackButton from "@/components/ui/goBack"
import { HiPlus, HiTrash, HiPencil } from "react-icons/hi"
import { LogoLoader } from "@/components/common/LogoLoader"

const ExpensesPage = () => {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [newExpense, setNewExpense] = useState<Partial<Expense>>({
    name: "",
    description: "",
    price: 0,
    icon: "",
  })

  useEffect(() => {
    fetchExpenses()
  }, [])

  const fetchExpenses = async () => {
    try {
      const response = await fetch("/api/admin/expenses/get")
      if (response.ok) {
        const data = await response.json()
        setExpenses(data)
      } else {
        toaster.create({
          title: "Error",
          description: "Failed to fetch expenses",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error fetching expenses:", error)
      toaster.create({
        title: "Error",
        description: "Failed to fetch expenses",
        duration: 5000,
      })
    } finally {
      setLoading(false)
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

    try {
      const response = await fetch("/api/admin/expenses/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...newExpense,
          price: dollarsToCents(newExpense.price || 0),
        }),
      })

      if (response.ok) {
        const createdExpense = await response.json()
        setExpenses((prev) => [createdExpense, ...prev])
        setNewExpense({ name: "", description: "", price: 0, icon: "" })
        setShowCreateForm(false)
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
    }
  }

  const updateExpense = async () => {
    if (
      !editingExpense?.id ||
      !editingExpense.name ||
      !editingExpense.description ||
      editingExpense.price === undefined
    ) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      })
      return
    }

    try {
      const response = await fetch(
        `/api/admin/expenses/update/${editingExpense.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...editingExpense,
            price: dollarsToCents(editingExpense.price || 0),
          }),
        },
      )

      if (response.ok) {
        const updatedExpense = await response.json()
        setExpenses((prev) =>
          prev.map((e) => (e.id === updatedExpense.id ? updatedExpense : e)),
        )
        setEditingExpense(null)
        toaster.create({
          title: "Success",
          description: "Expense updated successfully",
          duration: 5000,
        })
      } else {
        const error = await response.json()
        toaster.create({
          title: "Error",
          description: error.error || "Failed to update expense",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error updating expense:", error)
      toaster.create({
        title: "Error",
        description: "Failed to update expense",
        duration: 5000,
      })
    }
  }

  const deleteExpense = async (expenseId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this expense? This will also remove all assignments.",
      )
    ) {
      return
    }

    try {
      const response = await fetch(`/api/admin/expenses/delete/${expenseId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        setExpenses((prev) => prev.filter((e) => e.id !== expenseId))
        toaster.create({
          title: "Success",
          description: "Expense deleted successfully",
          duration: 5000,
        })
      } else {
        const error = await response.json()
        toaster.create({
          title: "Error",
          description: error.error || "Failed to delete expense",
          duration: 5000,
        })
      }
    } catch (error) {
      console.error("Error deleting expense:", error)
      toaster.create({
        title: "Error",
        description: "Failed to delete expense",
        duration: 5000,
      })
    }
  }

  const startEditing = (expense: Expense) => {
    setEditingExpense({
      ...expense,
      price: expense.price ? expense.price / 100 : 0, // Convert from cents to dollars
    })
  }

  if (loading) {
    return <LogoLoader size="lg" minHeight="100vh" />
  }

  return (
    <Box>
      <GoBackButton />
      <Box className="container mx-auto mt-12 p-4">
        <Box className="flex items-center justify-between mb-6">
          <Text className="text-3xl font-semibold">Manage Expenses</Text>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-[#2b7ff9] text-white"
          >
            <HiPlus className="mr-2" />
            {showCreateForm ? "Cancel" : "Create New Expense"}
          </Button>
        </Box>

        {/* Create/Edit Form */}
        {(showCreateForm || editingExpense) && (
          <Box className="mb-6 p-6 border rounded-lg bg-gray-50">
            <Text className="text-xl font-semibold mb-4">
              {editingExpense ? "Edit Expense" : "Create New Expense"}
            </Text>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Expense Name" required>
                <Input
                  value={editingExpense?.name || newExpense.name}
                  onChange={(e) => {
                    if (editingExpense) {
                      setEditingExpense((prev) =>
                        prev ? { ...prev, name: e.target.value } : null,
                      )
                    } else {
                      setNewExpense((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                  }}
                  placeholder="e.g., School Supplies"
                  className="border"
                />
              </Field>
              <Field label="Price (USD)" required>
                <Input
                  type="number"
                  value={editingExpense?.price || newExpense.price}
                  onChange={(e) => {
                    if (editingExpense) {
                      setEditingExpense((prev) =>
                        prev
                          ? { ...prev, price: parseFloat(e.target.value) || 0 }
                          : null,
                      )
                    } else {
                      setNewExpense((prev) => ({
                        ...prev,
                        price: parseFloat(e.target.value) || 0,
                      }))
                    }
                  }}
                  placeholder="0.00"
                  className="border"
                />
              </Field>
              <Field label="Icon (optional)">
                <Input
                  value={editingExpense?.icon || newExpense.icon}
                  onChange={(e) => {
                    if (editingExpense) {
                      setEditingExpense((prev) =>
                        prev ? { ...prev, icon: e.target.value } : null,
                      )
                    } else {
                      setNewExpense((prev) => ({
                        ...prev,
                        icon: e.target.value,
                      }))
                    }
                  }}
                  placeholder="e.g., 📚, 🎒"
                  className="border"
                />
              </Field>
              <Field label="Description" required>
                <Textarea
                  value={editingExpense?.description || newExpense.description}
                  onChange={(e) => {
                    if (editingExpense) {
                      setEditingExpense((prev) =>
                        prev ? { ...prev, description: e.target.value } : null,
                      )
                    } else {
                      setNewExpense((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  }}
                  placeholder="Describe what this expense covers"
                  className="border"
                />
              </Field>
            </Box>
            <Box className="flex gap-3 mt-4">
              <Button
                onClick={editingExpense ? updateExpense : createExpense}
                className="bg-[#2b7ff9] text-white"
              >
                {editingExpense ? "Update Expense" : "Create Expense"}
              </Button>
              <Button
                onClick={() => {
                  setShowCreateForm(false)
                  setEditingExpense(null)
                  setNewExpense({
                    name: "",
                    description: "",
                    price: 0,
                    icon: "",
                  })
                }}
                className="bg-gray-500 text-white"
              >
                Cancel
              </Button>
            </Box>
          </Box>
        )}

        {/* Expenses List */}
        <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {expenses.map((expense) => (
            <Box key={expense.id} className="border rounded-lg p-4 bg-white">
              <Box className="flex items-start justify-between mb-3">
                <Box className="flex items-center gap-2">
                  {expense.icon && (
                    <Text className="text-2xl">{expense.icon}</Text>
                  )}
                  <Text className="font-semibold text-lg">{expense.name}</Text>
                </Box>
                <Box className="flex gap-2">
                  <Button
                    onClick={() => startEditing(expense)}
                    className="bg-blue-500 text-white"
                    size="sm"
                  >
                    <HiPencil />
                  </Button>
                  <Button
                    onClick={() => deleteExpense(expense.id!)}
                    className="bg-red-500 text-white"
                    size="sm"
                  >
                    <HiTrash />
                  </Button>
                </Box>
              </Box>
              <Text className="text-gray-600 mb-2">{expense.description}</Text>
              <Text className="text-xl font-bold text-green-600">
                ${centsToDollars(expense.price)}
              </Text>
              <Text className="text-xs text-gray-500 mt-2">
                Created: {new Date(expense.created_at!).toLocaleDateString()}
              </Text>
            </Box>
          ))}
        </Box>

        {expenses.length === 0 && (
          <Box className="text-center py-12">
            <Text className="text-gray-500">
              No expenses found. Create your first expense to get started.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default ExpensesPage
