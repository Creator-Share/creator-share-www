import { fetchActivitiesByBeneficiaryId } from "@/actions";
import { Beneficiaries, Activity } from "@/types";
import { Box, Text, Flex } from "@chakra-ui/react";

async function getBeneficiary(username: string): Promise<Beneficiaries | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/children/get/username/${username}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.child || null;
  } catch {
    return null;
  }
}

interface ActivityPageProps {
  params: Promise<{ username: string; id: string }>;
}

export default async function ActivityDetailPage({ params }: ActivityPageProps) {
  const { username, id } = await params;
  const beneficiary = await getBeneficiary(username);

  if (!beneficiary) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="gray.500">No beneficiary found.</Text>
      </Flex>
    );
  }

  const activities: Activity[] = await fetchActivitiesByBeneficiaryId(beneficiary.id);
  const activity = activities.find((a) => a.id === id);

  if (!activity) {
    return (
      <Flex justify="center" align="center" minH="100vh">
        <Text color="gray.500">Activity not found.</Text>
      </Flex>
    );
  }

  return (
    <Box maxW="600px" mx="auto" mt={8} p={6} borderWidth="1px" borderRadius="md" boxShadow="md">
      <Text fontSize="2xl" fontWeight="bold" mb={4}>
        Activity Details
      </Text>
      <Text fontSize="lg" mb={2} className="font-bold">
        {activity.title}
      </Text>
      <Text fontSize="lg" mb={2}>
        {activity.description}
      </Text>
      <Text color="gray.500" mb={2}>
        Created: {new Date(activity.created_at).toISOString().replace("T", " ").slice(0, 16)}
      </Text>
      {Array.isArray(activity.images_url) && activity.images_url.length > 0 && (
        <Box mt={4}>
          <Text fontWeight="bold" mb={2}>Images:</Text>
          <Box display="flex" flexWrap="wrap" gap={2}>
            {activity.images_url.map((url: string, idx: number) => (
              <img
                key={idx}
                src={url}
                alt={`Activity image ${idx + 1}`}
                style={{ maxWidth: "180px", maxHeight: "180px", borderRadius: 8, border: "1px solid #eee" }}
              />
            ))}
          </Box>
        </Box>
      )}
      {Array.isArray(activity.videos_url) && activity.videos_url.length > 0 && (
        <Box mt={4}>
          <Text fontWeight="bold" mb={2}>Videos:</Text>
          <Box display="flex" flexWrap="wrap" gap={2}>
            {activity.videos_url.map((url: string, idx: number) => (
              <video
                key={idx}
                src={url}
                controls
                style={{ maxWidth: "320px", maxHeight: "180px", borderRadius: 8, border: "1px solid #eee" }}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
