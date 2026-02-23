"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/utils/supabase/client"
import { Box, Text, Input, Button, Alert } from "@chakra-ui/react"
import { toaster } from "@/components/ui/toaster"
import Image from "next/image"
import { validatePassword } from "@/utils/passwordValidation"
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator"

export default function SetPasswordPage() {
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [passwordCompleted, setPasswordCompleted] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        const checkAuth = async () => {
            // Check URL fragments for invitation tokens
            const hashParams = new URLSearchParams(window.location.hash.substring(1))
            const accessToken = hashParams.get('access_token')
            const refreshToken = hashParams.get('refresh_token')

            if (accessToken && refreshToken) {
                // Set session from invitation tokens
                const { error } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                })

                if (error) {
                    setError("Invalid invitation link")
                    return
                }

                // Clear URL fragments
                window.history.replaceState({}, document.title, window.location.pathname)
            }

            // Check if user is authenticated
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                setIsAuthenticated(true)
                // Check if user already has a password set
                if (user.user_metadata?.password_set) {
                    setPasswordCompleted(true)
                }
            } else {
                setError("Please use the invitation link to access this page")
            }
        }

        checkAuth()
    }, [supabase.auth])

    // More aggressive navigation prevention
    useEffect(() => {
        if (!isAuthenticated || passwordCompleted) return

        // Prevent browser back/forward
        const handlePopState = (e: PopStateEvent) => {
            e.preventDefault()
            window.history.pushState(null, "", window.location.href)
            toaster.create({
                title: "Cannot Leave",
                description: "Please complete password setup before leaving this page.",
                duration: 3000,
            })
        }

        // Prevent page unload
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
            return ""
        }

        // Prevent navigation attempts
        const handleKeyDown = (e: KeyboardEvent) => {
            // Prevent Alt+Left (back), Alt+Right (forward), F5 (refresh)
            if (
                (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) ||
                e.key === 'F5' ||
                (e.ctrlKey && e.key === 'r')
            ) {
                e.preventDefault()
                toaster.create({
                    title: "Cannot Leave",
                    description: "Please complete password setup before leaving this page.",
                    duration: 3000,
                })
            }
        }

        // Add history entry to prevent back button
        window.history.pushState(null, "", window.location.href)

        // Override router.push to prevent navigation
        const originalPush = router.push
        router.push = () => {
            toaster.create({
                title: "Cannot Leave",
                description: "Please complete password setup before leaving this page.",
                duration: 3000,
            })
            return Promise.resolve()
        }

        window.addEventListener("popstate", handlePopState)
        window.addEventListener("beforeunload", handleBeforeUnload)
        window.addEventListener("keydown", handleKeyDown)

        return () => {
            window.removeEventListener("popstate", handlePopState)
            window.removeEventListener("beforeunload", handleBeforeUnload)
            window.removeEventListener("keydown", handleKeyDown)
            router.push = originalPush
        }
    }, [isAuthenticated, passwordCompleted, router])

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        if (password !== confirmPassword) {
            setError("Passwords do not match")
            setLoading(false)
            return
        }

        const validation = validatePassword(password)
        if (!validation.isValid) {
            setError(validation.error)
            setLoading(false)
            return
        }

        try {
            const { error } = await supabase.auth.updateUser({
                password: password,
                data: {
                    password_set: true
                }
            })

            if (error) {
                setError(error.message)
                setLoading(false)
                return
            }

            // Assign the role after password is set
            try {
                const roleResponse = await fetch('/api/auth/complete-invitation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                })

                if (!roleResponse.ok) {
                    const roleError = await roleResponse.json()
                    console.error("Role assignment failed:", roleError)
                }
            } catch (roleError) {
                console.error("Error assigning role:", roleError)
            }

            setPasswordCompleted(true)

            toaster.create({
                title: "Success",
                description: "Password set successfully!",
                duration: 3000,
            })

            setTimeout(() => {
                router.push("/login")
            }, 1000)
        } catch {
            setError("An unexpected error occurred")
            setLoading(false)
        }
    }

    if (!isAuthenticated) {
        return (
            <Box className="min-h-screen flex items-center justify-center">
                <Box className="max-w-md w-full space-y-8 p-8">
                    <Box className="text-center">
                        <Image
                            src="/logo_text.svg"
                            alt="Creator Share"
                            width={200}
                            height={48}
                            className="mx-auto h-12 w-auto mb-6"
                        />
                        <Alert.Root status="error" className="mb-4">
                            <Alert.Indicator />
                            <Alert.Title>{error}</Alert.Title>
                        </Alert.Root>
                        <Button
                            onClick={() => router.push("/login")}
                            className="w-full bg-[#1C3C8C] text-white hover:bg-[#1C3C8C]"
                        >
                            Go to Login
                        </Button>
                    </Box>
                </Box>
            </Box>
        )
    }

    return (
        <Box className="min-h-screen flex items-center justify-center">
            <Box className="max-w-md w-full space-y-8 p-8">
                <Box className="text-center">
                    <Image
                        src="/logo_text.svg"
                        alt="Creator Share"
                        width={200}
                        height={48}
                        className="mx-auto h-12 w-auto mb-6"
                    />
                    <Text fontSize="2xl" fontWeight="bold" color="gray.900">
                        Set Your Password
                    </Text>
                    <Text fontSize="sm" color="gray.600" mt={2}>
                        Please set a password for your account
                    </Text>
                    {!passwordCompleted && (
                        <Alert.Root status="warning" className="mt-4">
                            <Alert.Indicator />
                            <Alert.Title>You must complete password setup to continue</Alert.Title>
                        </Alert.Root>
                    )}
                </Box>

                <form onSubmit={handleSetPassword} className="space-y-6">
                    {error && (
                        <Alert.Root status="error" className="mb-4">
                            <Alert.Indicator />
                            <Alert.Title>{error}</Alert.Title>
                        </Alert.Root>
                    )}

                    <Box>
                        <Text fontSize="sm" fontWeight="medium" color="gray.700" mb={2}>
                            New Password
                        </Text>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your password"
                                required
                                className="w-full border border-gray-300 rounded-md"
                                px={3}
                                py={2}
                            />
                            <PasswordStrengthIndicator password={password} />
                            <Text fontSize="xs" color="gray.600" mt={1}>
                                Password must contain at least 8 characters, including uppercase, lowercase, 
                                number, and special character (!@#$%^&*(),.?":{}|&lt;&gt;).
                            </Text>
                    </Box>

                    <Box>
                        <Text fontSize="sm" fontWeight="medium" color="gray.700" mb={2}>
                            Confirm Password
                        </Text>
                        <Input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm your password"
                            required
                            className="w-full border border-gray-300 rounded-md"
                            px={3}
                            py={2}
                        />
                    </Box>

                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-[#1C3C8C] text-white hover:bg-[#1C3C8C] disabled:opacity-50"
                        py={3}
                    >
                        {loading ? "Setting Password..." : "Set Password"}
                    </Button>
                </form>
            </Box>
        </Box>
    )
}
