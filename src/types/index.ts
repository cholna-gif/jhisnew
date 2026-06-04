export interface LatLng {
  lat: number;
  lng: number;
  address: string;
}

export type BookingMode = 'standard' | 'full_day' | 'scheduled' | 'favorite';
export type RideType = 'private' | 'share';
export type VehicleType = 'tuktuk' | 'car' | 'moto' | 'van';
export type RideStatus =
  | 'pending'
  | 'matched'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'scheduled'
  | 'no_drivers';

export interface Ride {
  id: string;
  created_at: string;
  passenger_id: string;
  driver_id?: string;
  driver_name?: string;
  booking_type?: string;
  ride_type: string;
  vehicle_type?: string;
  status: RideStatus;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  destination_address?: string;
  destination_lat?: number;
  destination_lng?: number;
  stops?: { lat: number; lng: number; address: string }[];
  group_size?: number;
  remaining_seats?: number;
  estimated_fare?: number;
  offered_fare?: number;
  agreed_price?: number;
  final_fare?: number;
  payment_method?: string;
  payment_status?: string;
  distance_km?: number;
  duration_minutes?: number;
  hire_description?: string;
  scheduled_datetime?: string;
  matched_at?: string;
  started_at?: string;
  arrived_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  cancelled_by?: string;
  passenger_rating?: number;
  passenger_review?: string;
  driver_rating?: number;
  driver_review?: string;
}

export interface Profile {
  id: string;
  full_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  wallet_balance?: number;
  is_suspended?: boolean;
  role?: string;
}
