import { supabase } from './supabase';
import { Profile, Ride } from '@/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

async function readResponseJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`Server returned non-JSON response from ${res.url}: ${preview}`);
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers = await getAuthHeader();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await readResponseJson(res);
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`);
  return json as T;
}

async function publicRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await readResponseJson(res);
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`);
  return json as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const AuthAPI = {
  signUp: (full_name: string, email: string, password: string, phone?: string) =>
    publicRequest<{ success: boolean; needsVerification: boolean }>('POST', '/api/auth/signup', {
      full_name,
      email,
      password,
      phone,
    }),
  verifyEmail: (email: string, code: string) =>
    publicRequest<{ success: boolean }>('POST', '/api/auth/verify-email', { email, code }),
  resendVerification: (email: string) =>
    publicRequest<{ success: boolean }>('POST', '/api/auth/resend-verification', { email }),
  requestPasswordReset: (email: string) =>
    publicRequest<{ success: boolean }>('POST', '/api/auth/forgot-password', { email }),
  resetPassword: (email: string, code: string, password: string) =>
    publicRequest<{ success: boolean }>('POST', '/api/auth/reset-password', { email, code, password }),
};

// ── Profile ──────────────────────────────────────────────────────────────────

export const ProfileAPI = {
  get: () => request<Profile>('GET', '/api/profile'),
  create: (full_name: string, email: string) =>
    request<{ success: boolean }>('POST', '/api/profile', { full_name, email }),
  update: (updates: { full_name?: string; phone?: string; wallet_balance?: number }) =>
    request<Profile>('PUT', '/api/profile', updates),
  deductWallet: (amount: number) =>
    request<{ wallet_balance: number }>('POST', '/api/profile/wallet/deduct', { amount }),
};

// ── Rides ─────────────────────────────────────────────────────────────────────

export const RidesAPI = {
  book: (rideData: Omit<Ride, 'id' | 'created_at' | 'passenger_id'>) =>
    request<Ride>('POST', '/api/rides', rideData),
  getActive: () => request<Ride | null>('GET', '/api/rides/active'),
  getHistory: () => request<Ride[]>('GET', '/api/rides/history'),
  hasActive: () =>
    request<{ hasActiveRide: boolean }>('GET', '/api/rides/guard/active'),
  getById: (id: string) => request<Ride | null>('GET', `/api/rides/${id}`),
  cancel: (id: string, reason?: string, payment_status?: string, final_fare?: number | null) =>
    request<Ride>('PATCH', `/api/rides/${id}/cancel`, { reason, payment_status, final_fare }),
  clearStuck: () => request<{ cleared: number }>('POST', '/api/rides/clear-stuck'),
  retry: (id: string) => request<Ride>('POST', `/api/rides/${id}/retry`),
  rate: (id: string, driver_id: string, rating: number, review?: string) =>
    request<{ success: boolean }>('PATCH', `/api/rides/${id}/rate`, {
      driver_id,
      rating,
      review,
    }),
};

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  created_at: string;
}

export const ChatAPI = {
  getMessages: (rideId: string) =>
    request<ChatMessage[]>('GET', `/api/chat/${rideId}`),
  sendMessage: (rideId: string, message: string, sender_role: string) =>
    request<ChatMessage>('POST', `/api/chat/${rideId}`, { message, sender_role }),
};

// ── Support ───────────────────────────────────────────────────────────────────

export const SupportAPI = {
  submit: (subject: string, category: string, message: string) =>
    request<{ id: string }>('POST', '/api/support', { subject, category, message }),
};

// ── Favorites ─────────────────────────────────────────────────────────────────

export interface FavoriteDriver {
  id: string;
  passenger_id: string;
  driver_id: string;
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export interface DriverInfo {
  full_name: string | null;
  driver_profile: Record<string, unknown> | null;
}

export interface DriverLocation {
  current_lat: number;
  current_lng: number;
}

export interface OnlineDriver {
  user_id: string;
  current_lat: number;
  current_lng: number;
  vehicle_type?: string;
}

export const DriversAPI = {
  get: (driverId: string) =>
    request<DriverInfo>('GET', `/api/drivers/${driverId}`),
  getLocation: (driverId: string) =>
    request<DriverLocation>('GET', `/api/drivers/${driverId}/location`),
  getOnline: () =>
    request<OnlineDriver[]>('GET', '/api/drivers/online'),
};

// ── Favorites ─────────────────────────────────────────────────────────────────

export const FavoritesAPI = {
  list: () => request<FavoriteDriver[]>('GET', '/api/favorites'),
  check: (driverId: string) =>
    request<{ isFavorite: boolean }>('GET', `/api/favorites/${driverId}`),
  add: (driver_id: string) =>
    request<{ success: boolean }>('POST', '/api/favorites', { driver_id }),
  remove: (driverId: string) =>
    request<{ success: boolean }>('DELETE', `/api/favorites/${driverId}`),
};
