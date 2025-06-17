import { fetchActivitiesByBeneficiaryId } from "@/actions";
import BeneficiarySubscribeBox from "@/components/BeneficiarySubscribeBox";
import { Beneficiaries, Activity } from "@/types";
import { Box, Text, Flex, Button, Input, Textarea } from "@chakra-ui/react";
import Image from "next/image";
import Link from "next/link";

async function getBeneficiary(username: string): Promise<Beneficiaries | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/beneficiaries/get/username/${username}`, {
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

  // For "Other Updates", show up to 3 other activities
  const otherActivities = activities.filter((a) => a.id !== id).slice(0, 3);

  return (
    <Box maxW="7xl" mx="auto" mt={8} p={0}>
      {/* Breadcrumb */}
      <Box px={{ base: 4, md: 0 }} mb={2}>
        <Text fontSize="sm" color="gray.500">
          <Link href="/sponsorships" className="hover:underline">Home</Link> /{" "}
          <Link href={`/sponsorships/${username}`} className="hover:underline">Child sponsorship</Link> /{" "}
          <Text as="span" fontWeight="bold" color="gray.700" display="inline">
            {beneficiary.name} / {activity.title}
          </Text>
        </Text>
      </Box>

      {/* Title and Sponsor Button */}
      <Flex align="center" justify="space-between" mb={4} px={{ base: 4, md: 0 }}>
        <Text fontSize={{ base: "2xl", md: "4xl" }} fontWeight="bold" color="blue-700" className="text-blue-700">
          {activity.title}
        </Text>
        <Button colorScheme="blue" size="md" className="px-6 py-2 rounded-md shadow">
          Sponsor Me
        </Button>
      </Flex>

      {/* Author, Date, Comments */}
      <Flex color="gray.500" fontSize="sm" mb={2} px={{ base: 4, md: 0 }} className="gap-6 flex-row">
        <Text>👤 {beneficiary.name}</Text>
        <Text>📅 {new Date(activity.created_at).toLocaleDateString()}</Text>
        <Text>💬 2 Comments</Text>
      </Flex>

      {/* Main Image */}
      {Array.isArray(activity.images_url) && activity.images_url.length > 0 && (
        <Box w="100%" maxH="400px" mb={6} borderRadius="md" overflow="hidden" boxShadow="md" className="bg-white px-4 md:px-0">
          <Image
            src={activity.images_url[0]}
            alt="Main activity image"
            width={900}
            height={400}
            style={{ objectFit: "cover", width: "100%", height: "400px" }}
            priority
          />
        </Box>
      )}

      {/* Main Content */}
      <Box mb={8} px={{ base: 4, md: 0 }}>
        <Text color="gray.700" mb={4}>
          Raising a teenager can feel like navigating a storm—one moment everything is calm, and the next, you’re caught in a whirlwind of emotions, attitudes, and change. But beneath that stormy sea is a young person trying to figure out who they are and how they fit into the world. Your job as a parent isn’t to control the storm, but to be the steady lighthouse they can rely on.
        </Text>
        <Text as="span" fontWeight="bold" color="blue.700" fontSize="lg" display="block" mb={1} className="text-blue-700">
          The Brain Behind the Behavior
        </Text>
        <Text color="gray.700" mb={4}>
          Teen brains are still developing—especially the prefrontal cortex, which governs decision-making and impulse control. This means they may act impulsively, take risks, or seem emotionally volatile. Understanding this can help you approach conflict with more empathy and patience.
        </Text>
        <Text as="span" fontWeight="bold" color="blue.700" fontSize="lg" display="block" mb={1} className="text-blue-700">
          Boundaries Still Matter
        </Text>
        <Text color="gray.700" mb={4}>
          Kids’ wishes to push for independence. They still need boundaries. Set clear, consistent rules and consequences—but involve them in the process. When teens feel heard, they’re more likely to cooperate and grow into responsible adults.
        </Text>
      </Box>

      {/* Video */}
      {Array.isArray(activity.videos_url) && activity.videos_url.length > 0 && (
        <Box w="100%" maxW="700px" mx="auto" mb={8} borderRadius="md" overflow="hidden" boxShadow="md" className="bg-white px-4 md:px-0">
          <video
            src={activity.videos_url[0]}
            controls
            style={{ width: "100%", height: "350px", objectFit: "cover", borderRadius: 8, border: "1px solid #eee" }}
          />
        </Box>
      )}

      {/* More Content */}
      <Box mb={8} px={{ base: 4, md: 0 }}>
        <Text as="span" fontWeight="bold" color="blue.700" fontSize="lg" display="block" mb={1} className="text-blue-700">
          Communication is Key (and Tricky)
        </Text>
        <Text color="gray.700" mb={4}>
          The days of chatting freely might never pass, but communication hasn’t stopped—it’s just changed. Instead of grilling them, ask open-ended questions. Listen more than you talk. Be curious, not judgmental. Trust grows in small, steady moments.
        </Text>
      </Box>

      {/* Comment Form and Subscribe Box */}
      <Flex gap={6} mb={10} flexWrap={{ base: "wrap", md: "nowrap" }} px={{ base: 4, md: 0 }}>
        {/* Comment Form */}
        <Box flex="2" minW="300px" bg="white" p={4} borderRadius="md" boxShadow="sm" mb={{ base: 6, md: 0 }}>
          <Text fontWeight="bold" mb={2}>Comment</Text>
          <form className="flex flex-col gap-3">
            <Textarea placeholder="Write your comment..." />
            <Input placeholder="Name" />
            <Input placeholder="Email" type="email" />
            <Button colorScheme="blue" w="fit-content" alignSelf="flex-end" type="submit">
              Post Comment
            </Button>
          </form>
        </Box>
        {/* Subscribe Box */}
        <BeneficiarySubscribeBox beneficiary={beneficiary} />
      </Flex>

      {/* Other Updates */}
      <Box px={{ base: 4, md: 0 }}>
        <Text fontWeight="bold" fontSize="lg" mb={4} color="gray.700">
          Other Updates on {beneficiary.name}
        </Text>
        <Flex gap={4} flexWrap="wrap">
          {otherActivities.map((a) => (
            <Box
              key={a.id}
              bg="white"
              borderRadius="md"
              boxShadow="sm"
              p={3}
              w={{ base: "100%", sm: "48%", md: "32%" }}
              minW="220px"
              maxW="300px"
              mb={4}
              className="flex flex-col"
            >
              {Array.isArray(a.images_url) && a.images_url.length > 0 && (
                <Box mb={2} borderRadius="md" overflow="hidden" h="160px" className="bg-gray-100">
                  <Image
                    src={a.images_url[0]}
                    alt="Activity thumbnail"
                    width={300}
                    height={160}
                    style={{ objectFit: "cover", width: "100%", height: "160px" }}
                  />
                </Box>
              )}
              <Text fontWeight="bold" fontSize="md" mb={1} className="line-clamp-1">{a.title}</Text>
              <Flex color="gray.500" fontSize="xs" mb={1} className="gap-2 flex-row">
                <Text>📅 {new Date(a.created_at).toLocaleDateString()}</Text>
                <Text>💬 3 Comments</Text>
              </Flex>
              <Text fontSize="sm" color="gray.600" className="line-clamp-2 mb-2">
                {a.description}
              </Text>
              <Link href={`/sponsorships/${username}/activity/${a.id}`}>
                <Button size="sm" colorScheme="blue" variant="outline" w="full">
                  Read More
                </Button>
              </Link>
            </Box>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
