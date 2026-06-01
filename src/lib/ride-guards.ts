import { ProfileAPI, RidesAPI } from './api';

export async function hasActiveRide(_userId: string): Promise<boolean> {
  const { hasActiveRide } = await RidesAPI.hasActive();
  return hasActiveRide;
}

export async function isPassengerSuspended(_userId: string): Promise<boolean> {
  const profile = await ProfileAPI.get();
  return !!(profile as { is_suspended?: boolean })?.is_suspended;
}

export const SUSPENDED_BOOKING_MSG =
  'Your account has been suspended. Please contact Jih support for help.';
