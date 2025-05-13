import { createClient } from '@/utils/supabase/client'
import { Subscription } from '@/types'

export async function fetchSponsorshipDetailsSponsorshipId(sponsorshipId: string): Promise<Subscription[]> {
  if (!sponsorshipId) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .select(`
      *,
      sponsorships:sponsorship_id (
        child_details(*)
      )
    `)
    .eq('sponsorship_id', sponsorshipId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching subscriptions:', error);
    return [];
  }

  return data || [];
}

export async function fetchActivitiesById(sponsorshipId: string) {
  if (!sponsorshipId) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sponsorship_activities')
    .select('*')
    .eq('sponsorship_id', sponsorshipId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching activities:', error);
    return [];
  }

  return data || [];
}
