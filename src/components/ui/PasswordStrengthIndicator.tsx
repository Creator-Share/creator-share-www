import { Box, Text } from "@chakra-ui/react";
import { getPasswordStrength } from "@/utils/passwordValidation";

interface PasswordStrengthIndicatorProps {
  password: string;
}

export const PasswordStrengthIndicator = ({ password }: PasswordStrengthIndicatorProps) => {
  const strength = getPasswordStrength(password);
  
  const getColor = () => {
    switch (strength) {
      case "strong":
        return "#22C55E"; // green
      case "medium":
        return "#F59E0B"; // yellow
      case "weak":
        return "#EF4444"; // red
      default:
        return "#D1D5DB"; // gray
    }
  };

  const getWidth = () => {
    switch (strength) {
      case "strong":
        return "100%";
      case "medium":
        return "66%";
      case "weak":
        return "33%";
      default:
        return "0%";
    }
  };

  return (
    <Box mt={2}>
      <Box
        w="100%"
        h="4px"
        bg="#F3F4F6"
        borderRadius="full"
        overflow="hidden"
      >
        <Box
          h="100%"
          w={getWidth()}
          bg={getColor()}
          transition="all 0.3s ease"
        />
      </Box>
      <Text
        mt={1}
        fontSize="sm"
        color={getColor()}
        textTransform="capitalize"
      >
        Password Strength: {strength}
      </Text>
    </Box>
  );
};
