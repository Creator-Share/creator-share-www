export const validatePassword = (password: string): { isValid: boolean; error: string } => {
  if (!password) {
    return { isValid: false, error: "Password is required" };
  }

  if (password.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters long" };
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one uppercase letter" };
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one lowercase letter" };
  }

  // Check for at least one number
  if (!/\d/.test(password)) {
    return { isValid: false, error: "Password must contain at least one number" };
  }

  // Check for at least one special character
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>)" };
  }

  return { isValid: true, error: "" };
};

export const getPasswordStrength = (password: string): "weak" | "medium" | "strong" => {
  if (!password) return "weak";

  let score = 0;

  // Length check
  if (password.length >= 12) score += 2;
  else if (password.length >= 8) score += 1;

  // Character variety checks
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;

  // Variety of characters check
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= 8) score += 2;
  else if (uniqueChars >= 6) score += 1;

  if (score >= 6) return "strong";
  if (score >= 4) return "medium";
  return "weak";
};
