"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Beneficiaries } from "@/types/admin.types";

interface ApiResult {
  message?: string;
  child?: Beneficiaries;
  timestamp?: string;
  error?: string;
  details?: string;
}

export default function TestTelegramPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ApiResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const testTelegramBot = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/test/telegram', {
        method: 'POST'
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to test Telegram bot')
      }
      
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const createTestChild = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/test/create-child', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: "Test Child",
          gender: "Boy",
          birth_date: "2010-01-01"
        })
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create test child')
      }
      
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const createCustomChild = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/test/create-child', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: "Custom Test Child",
          gender: "Girl",
          birth_date: "2012-05-15",
          biography: "This is a custom test child created through the web interface.",
          introduction: "Hi! I'm a custom test child created to verify the system works.",
          budget_goal: 75000, // $750.00
          country: "Philippines",
          location_str: "Cebu, Philippines"
        })
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create custom test child')
      }
      
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Telegram Bot Test Interface</h1>
      
      <div className="grid gap-6">
        {/* Test Telegram Bot */}
        <div className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">1. Test Telegram Bot Connection</h2>
          <p className="text-gray-600 mb-4">
            Test if your Telegram bot is properly configured and can send messages.
          </p>
          <Button 
            onClick={testTelegramBot} 
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? "Testing..." : "Test Telegram Bot"}
          </Button>
        </div>

        {/* Create Test Child */}
        <div className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">2. Create Test Child (Default Data)</h2>
          <p className="text-gray-600 mb-4">
            Create a child with default test data to trigger the Telegram notification.
          </p>
          <Button 
            onClick={createTestChild} 
            disabled={loading}
            className="bg-green-600 hover:bg-green-700"
          >
            {loading ? "Creating..." : "Create Test Child"}
          </Button>
        </div>

        {/* Create Custom Child */}
        <div className="border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">3. Create Custom Test Child</h2>
          <p className="text-gray-600 mb-4">
            Create a child with custom data to test the notification system.
          </p>
          <Button 
            onClick={createCustomChild} 
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {loading ? "Creating..." : "Create Custom Child"}
          </Button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Results</h2>
            
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
                <h3 className="font-semibold text-red-800">Error:</h3>
                <p className="text-red-700">{error}</p>
              </div>
            )}
            
            {result && (
              <div className="bg-green-50 border border-green-200 rounded p-4">
                <h3 className="font-semibold text-green-800">Success:</h3>
                <pre className="text-green-700 mt-2 whitespace-pre-wrap overflow-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="border rounded-lg p-6 bg-gray-50">
          <h2 className="text-xl font-semibold mb-4">Setup Instructions</h2>
          <div className="space-y-2 text-sm">
            <p><strong>1.</strong> Make sure you have added the environment variables to your <code>.env.local</code>:</p>
            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
{`TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_numerical_chat_id`}
            </pre>
            <p><strong>2.</strong> Get your chat ID by messaging your bot and visiting:</p>
            <code className="bg-gray-100 p-1 rounded text-xs">
              https://api.telegram.org/(your bot token)/getUpdates
            </code>
            <p><strong>3.</strong> Restart your development server after adding environment variables.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
