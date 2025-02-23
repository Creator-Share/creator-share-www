import { createClient } from '@/utils/supabase/client'
import { Subscription } from '@/types'

export async function fetchSponsorshipDetailsByChildId(childId: string): Promise<Subscription[]> {
  if (!childId) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from('subscriptions')
    .select(`
      *,
      child:sponsor_people(
        name
      )
    `)
    .eq('child_id', childId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching subscriptions:', error)
    return []
  }

  return data || []
}

export async function fetchActivitiesByChildId(childId: string) {
  if (!childId) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('people_activities')
    .select('*')
    .eq('child_id', childId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching activities:', error);
    return [];
  }

  return data || [];
}