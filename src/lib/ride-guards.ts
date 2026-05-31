import { supabase } from './supabase';

export async function hasActiveRide(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('rides')
    .select('id')
    .eq('passenger_id', userId)
    .in('status', ['pending', 'matched', 'arrived', 'in_progress'])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function isPassengerSuspended(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('is_suspended')
    .eq('id', userId)
    .maybeSingle();
  return !!(data as any)?.is_suspended;
}

export const SUSPENDED_BOOKING_MSG =
  'Your account has been suspended. Please contact Jih support for help.';
