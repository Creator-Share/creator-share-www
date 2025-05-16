import { createClient } from '@/utils/supabase/client'
import { Subscription } from '@/types'

export async function fetchSponsorshipDetailsByChildId(beneficiaryId: string): Promise<Subscription[]> {
  if (!beneficiaryId) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from('subscriptions')
    .select(`
      *,
      child:sponsor_people(
        name
      )
    `)
    .eq('beneficiary_id', beneficiaryId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching subscriptions:', error)
    return []
  }

  return data || []
}

export async function fetchActivitiesByChildId(beneficiaryId: string) {
  if (!beneficiaryId) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('acitivities')
    .select('*')
    .eq('beneficiary_id', beneficiaryId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching activities:', error);
    return [];
  }

  return data || [];
}