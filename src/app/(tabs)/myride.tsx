import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatDualCurrency } from '@/lib/currency';
import { Ride } from '@/types';

export default function MyRideScreen() {
  const { user } = useAuth();
  const [ride, setRide]               = useState<Ride | null>(null);
  const [loading, setLoading]         = useState(true);
  const [cancelling, setCancelling]   = useState(false);
  const [driverName, setDriverName]   = useState('');
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [isFavorite, setIsFavorite]   = useState(false);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [pendingSecondsLeft, setPendingSecondsLeft] = useState<number | null>(null);
  const [driverCancelledRide, setDriverCancelledRide] = useState<Ride | null>(null);
  const [rating, setRating]           = useState(0);
  const [review, setReview]           = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showRating, setShowRating]   = useState(false);

  // Stuck-ride force-clear state
  const [stuckRideId, setStuckRideId] = useState<string | null>(null);
  const [clearingStuck, setClearingStuck] = useState(false);

  const activeRideIdRef          = useRef<string | null>(null);
  const completionFlowStarted    = useRef(false);
  const pendingTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCountdownRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch active ride ─────────────────────────────────────────────────────
  const fetchActiveRide = useCallback(async () => {
    if (!user) return;

    const { data } = await supabase
      .from('rides' as any)
      .select('*')
      .eq('passenger_id', user.id)
      .in('status', ['pending', 'matched', 'arrived', 'in_progress', 'completed'])
      .order('created_at', { ascending: false })
      .limit(1) as any;

    const activeRide = data?.[0] as Ride | undefined;

    if (activeRide?.status === 'completed') {
      if (completionFlowStarted.current || activeRideIdRef.current === activeRide.id) {
        completionFlowStarted.current = true;
        setRide(activeRide);
      }
    } else if (completionFlowStarted.current) {
      // keep post-ride flow mounted
    } else if (!activeRide) {
      // Check if driver recently cancelled
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: cancelledData } = await supabase
        .from('rides' as any)
        .select('*')
        .eq('passenger_id', user.id)
        .eq('status', 'cancelled')
        .eq('cancelled_by', 'driver')
        .gte('cancelled_at', tenMinutesAgo)
        .order('cancelled_at', { ascending: false })
        .limit(1) as any;
      setDriverCancelledRide((cancelledData as Ride[])?.[0] || null);
      setRide(null);
      activeRideIdRef.current = null;
      setStuckRideId(null);
    } else {
      setDriverCancelledRide(null);
      setRide(activeRide);
      activeRideIdRef.current = activeRide.id;
      setStuckRideId(null);

      if (activeRide.driver_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', activeRide.driver_id)
          .maybeSingle();
        setDriverName((prof as any)?.full_name || 'Driver');

        const { data: dp } = await supabase
          .from('driver_profiles' as any)
          .select('*')
          .eq('user_id', activeRide.driver_id)
          .maybeSingle();
        setDriverProfile(dp);

        const { data: fav } = await supabase
          .from('favorite_drivers' as any)
          .select('id')
          .eq('passenger_id', user.id)
          .eq('driver_id', activeRide.driver_id)
          .maybeSingle() as any;
        setIsFavorite(!!fav);
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchActiveRide();
    const interval = setInterval(fetchActiveRide, 3000);
    const channel = supabase
      .channel(`passenger-ride-${user?.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'rides',
        filter: `passenger_id=eq.${user?.id}`,
      }, () => fetchActiveRide())
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchActiveRide]);

  // 3-minute pending timeout
  useEffect(() => {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    if (ride?.status === 'pending' && !pendingTimedOut) {
      const elapsed   = ride.created_at ? Date.now() - new Date(ride.created_at).getTime() : 0;
      const remaining = Math.max(0, 3 * 60 * 1000 - elapsed);
      pendingTimerRef.current = setTimeout(() => setPendingTimedOut(true), remaining);
    }
    if (ride?.status && ride.status !== 'pending') setPendingTimedOut(false);
    return () => { if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); };
  }, [ride?.id, ride?.status, ride?.created_at, pendingTimedOut]);

  // Auto-cancel after timeout
  useEffect(() => {
    if (!pendingTimedOut || !ride || ride.status !== 'pending') return;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('rides' as any).select('status').eq('id', ride.id).maybeSingle() as any;
      if (data?.status === 'pending') {
        await supabase.from('rides' as any).update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'No driver available (timeout)',
        } as any).eq('id', ride.id);
        activeRideIdRef.current = null;
        setRide(null);
        setPendingTimedOut(false);
      }
    }, 60 * 1000);
    return () => clearTimeout(t);
  }, [pendingTimedOut, ride]);

  // Countdown
  useEffect(() => {
    if (pendingCountdownRef.current) { clearInterval(pendingCountdownRef.current); pendingCountdownRef.current = null; }
    setPendingSecondsLeft(null);
    if (ride?.status !== 'pending' || ride?.booking_type === 'full_day' || pendingTimedOut) return;
    const MS = 3 * 60 * 1000;
    const getLeft = () => {
      const elapsed = ride.created_at ? Date.now() - new Date(ride.created_at).getTime() : 0;
      return Math.max(0, Math.floor((MS - elapsed) / 1000));
    };
    setPendingSecondsLeft(getLeft());
    pendingCountdownRef.current = setInterval(() => {
      const r = getLeft();
      setPendingSecondsLeft(r);
      if (r <= 0) { clearInterval(pendingCountdownRef.current!); pendingCountdownRef.current = null; }
    }, 1000);
    return () => { if (pendingCountdownRef.current) clearInterval(pendingCountdownRef.current); };
  }, [ride?.id, ride?.status, ride?.booking_type, ride?.created_at, pendingTimedOut]);

  // ── Cancel ride ───────────────────────────────────────────────────────────
  const handleCancelRide = async () => {
    if (!ride) return;
    setCancelling(true);
    await supabase.from('rides' as any).update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Cancelled by passenger',
    } as any).eq('id', ride.id);
    activeRideIdRef.current = null;
    completionFlowStarted.current = false;
    setRide(null);
    setPendingTimedOut(false);
    setCancelling(false);
  };

  // Force-clear any stuck active rides (shown on "No Active Ride" screen)
  const handleClearStuck = async () => {
    if (!user) return;
    setClearingStuck(true);
    const { data } = await supabase
      .from('rides' as any)
      .select('id')
      .eq('passenger_id', user.id)
      .in('status', ['pending', 'matched', 'arrived', 'in_progress'])
      .order('created_at', { ascending: false }) as any;

    if (data && data.length > 0) {
      for (const r of data) {
        await supabase.from('rides' as any).update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Force-cleared by passenger',
        } as any).eq('id', r.id);
      }
    }
    setStuckRideId(null);
    setClearingStuck(false);
    fetchActiveRide();
  };

  const handleTryAgain = async () => {
    if (!ride) return;
    await supabase.from('rides' as any).update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'No driver — passenger retried',
    } as any).eq('id', ride.id);
    const { data: created, error } = await supabase.from('rides' as any).insert({
      passenger_id: ride.passenger_id,
      pickup_address: ride.pickup_address, pickup_lat: ride.pickup_lat, pickup_lng: ride.pickup_lng,
      destination_address: ride.destination_address, destination_lat: ride.destination_lat, destination_lng: ride.destination_lng,
      distance_km: ride.distance_km, duration_minutes: ride.duration_minutes,
      estimated_fare: ride.estimated_fare, offered_fare: ride.offered_fare,
      vehicle_type: ride.vehicle_type, ride_type: ride.ride_type,
      booking_type: ride.booking_type, hire_description: ride.hire_description,
      group_size: ride.group_size, payment_method: ride.payment_method, status: 'pending',
    } as any).select().single() as any;
    if (error) { setRide(null); setPendingTimedOut(false); return; }
    setPendingTimedOut(false);
    setRide(created as Ride);
    activeRideIdRef.current = created.id;
  };

  const toggleFavorite = async () => {
    if (!ride?.driver_id || !user) return;
    if (isFavorite) {
      await supabase.from('favorite_drivers' as any).delete().eq('passenger_id', user.id).eq('driver_id', ride.driver_id);
      setIsFavorite(false);
    } else {
      await supabase.from('favorite_drivers' as any).insert({ passenger_id: user.id, driver_id: ride.driver_id } as any);
      setIsFavorite(true);
    }
  };

  const handleSubmitRating = async () => {
    if (!ride || rating === 0) return;
    setSubmittingRating(true);
    await supabase.from('rides' as any).update({ driver_rating: rating, driver_review: review } as any).eq('id', ride.id);
    if (ride.driver_id) {
      await supabase.from('ride_ratings').insert({ ride_id: ride.id, rater_id: user!.id, rated_id: ride.driver_id, rating, review, rated_as: 'driver' });
      const { data: all } = await supabase.from('ride_ratings').select('rating').eq('rated_id', ride.driver_id).eq('rated_as', 'driver');
      if (all && all.length > 0) {
        const avg = all.reduce((s: number, r: any) => s + r.rating, 0) / all.length;
        await supabase.from('driver_profiles' as any).update({ average_rating: parseFloat(avg.toFixed(2)) } as any).eq('user_id', ride.driver_id);
      }
    }
    setSubmittingRating(false);
    completionFlowStarted.current = false;
    setRide(null);
    setShowRating(false);
  };

  // ── Cancel button (shared across states) ────────────────────────────────
  const CancelBtn = ({ label = 'Cancel Ride' }: { label?: string }) => (
    <TouchableOpacity
      style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]}
      onPress={handleCancelRide}
      disabled={cancelling}
    >
      {cancelling
        ? <ActivityIndicator color="#ef4444" size="small" />
        : <Text style={styles.cancelBtnText}>{label}</Text>
      }
    </TouchableOpacity>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#1A2744" />
      </SafeAreaView>
    );
  }

  // ── Driver cancelled ──────────────────────────────────────────────────────
  if (driverCancelledRide) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.bigIcon}>😔</Text>
        <Text style={styles.bigTitle}>Your driver cancelled</Text>
        <Text style={styles.subText}>We're sorry for the inconvenience.</Text>
        <TouchableOpacity style={styles.navyBtn} onPress={() => setDriverCancelledRide(null)}>
          <Text style={styles.navyBtnText}>Dismiss</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── No active ride ────────────────────────────────────────────────────────
  if (!ride) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.bigIcon}>🛺</Text>
        <Text style={styles.bigTitle}>No Active Ride</Text>
        <Text style={styles.subText}>Book a ride from the Book tab to get started.</Text>
        <TouchableOpacity style={styles.navyBtn} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.navyBtnText}>Book a Ride →</Text>
        </TouchableOpacity>

        {/* Force-clear helper — if booking says "active ride exists" but nothing shows here */}
        <TouchableOpacity
          style={[styles.clearStuckBtn, clearingStuck && { opacity: 0.5 }]}
          onPress={handleClearStuck}
          disabled={clearingStuck}
        >
          {clearingStuck
            ? <ActivityIndicator color="#6b7280" size="small" />
            : <Text style={styles.clearStuckText}>🔧 Clear any stuck rides</Text>
          }
        </TouchableOpacity>
        <Text style={styles.clearStuckHint}>
          Use this if booking says you have an active ride but nothing appears here.
        </Text>
      </SafeAreaView>
    );
  }

  // ── Pending ───────────────────────────────────────────────────────────────
  if (ride.status === 'pending') {
    const isFullDay = ride.booking_type === 'full_day';

    if (pendingTimedOut && !isFullDay) {
      return (
        <SafeAreaView style={styles.center}>
          <Text style={styles.bigIcon}>⏰</Text>
          <Text style={styles.bigTitle}>No drivers nearby right now</Text>
          <Text style={styles.subText}>Try again in a few minutes.</Text>
          <View style={styles.actionRow}>
            <CancelBtn label="Cancel" />
            <TouchableOpacity style={styles.navyBtn} onPress={handleTryAgain}>
              <Text style={styles.navyBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.center}>
        {/* Pulsing ring */}
        <View style={styles.pulseWrap}>
          <View style={styles.pulseRing} />
          <View style={styles.pulseInner}>
            <ActivityIndicator size="large" color="#1A2744" />
          </View>
        </View>

        <Text style={styles.bigTitle}>
          {isFullDay ? 'Looking for a driver for your offer…' : 'Looking for a driver…'}
        </Text>

        {pendingSecondsLeft !== null && !isFullDay && (
          <Text style={[
            styles.countdown,
            pendingSecondsLeft <= 30 ? { color: '#ef4444' } :
            pendingSecondsLeft <= 60 ? { color: '#f59e0b' } : { color: '#6b7280' },
          ]}>
            {pendingSecondsLeft <= 10
              ? 'Cancelling soon…'
              : `${Math.floor(pendingSecondsLeft / 60)}:${String(pendingSecondsLeft % 60).padStart(2, '0')} remaining`}
          </Text>
        )}

        {/* Ride summary */}
        <View style={styles.rideCard}>
          <RideRow icon="📍" text={ride.pickup_address || 'Pickup'} />
          {!isFullDay && <RideRow icon="🏁" text={ride.destination_address || 'Destination'} />}
          {isFullDay && ride.hire_description && <Text style={styles.cardMeta}>{ride.hire_description}</Text>}
          <View style={[styles.cardRow, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, marginTop: 4 }]}>
            <Text style={styles.cardMeta}>{ride.vehicle_type}</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A2744' }}>
              ${(isFullDay ? ride.offered_fare : ride.estimated_fare)?.toFixed(2)}
            </Text>
          </View>
        </View>

        <CancelBtn />
      </SafeAreaView>
    );
  }

  // ── Matched / Arrived ─────────────────────────────────────────────────────
  if (ride.status === 'matched' || ride.status === 'arrived') {
    const fareDisplay = ride.booking_type === 'full_day'
      ? (ride.agreed_price || ride.offered_fare)
      : ride.estimated_fare;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {/* ETA banner */}
          <View style={ride.status === 'arrived' ? styles.bannerGreen : styles.bannerBlue}>
            <Text style={styles.bannerText}>
              {ride.status === 'arrived' ? '✅ Your driver has arrived!' : '🛺 Driver on the way…'}
            </Text>
          </View>

          <Text style={styles.statusTitle}>
            {ride.status === 'matched' ? 'Driver Found!' : 'Driver Arrived!'}
          </Text>

          {/* Driver card */}
          <View style={styles.driverCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{driverName.charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.driverName}>{driverName || 'Your Driver'}</Text>
                <TouchableOpacity onPress={toggleFavorite}>
                  <Text style={{ fontSize: 18 }}>{isFavorite ? '❤️' : '🤍'}</Text>
                </TouchableOpacity>
              </View>
              {driverProfile && (
                <Text style={styles.driverVehicle}>
                  {driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}
                </Text>
              )}
              <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                {ride.status === 'matched' ? 'On the way to you…' : 'Waiting at pickup location'}
              </Text>
            </View>
          </View>

          {/* Fare */}
          <View style={styles.infoCard}>
            <InfoRow label="Distance" value={`${ride.distance_km?.toFixed(1)} km`} />
            <InfoRow label="Duration" value={`${ride.duration_minutes} min`} />
            <InfoRow label="Fare" value={formatDualCurrency(fareDisplay ?? 0)} bold />
            <InfoRow label="Payment" value={ride.payment_method ?? 'cash'} />
          </View>

          <CancelBtn />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── In progress ───────────────────────────────────────────────────────────
  if (ride.status === 'in_progress') {
    const fareDisplay = ride.booking_type === 'full_day'
      ? (ride.agreed_price || ride.offered_fare)
      : ride.estimated_fare;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <View style={styles.bannerBlue}>
            <Text style={styles.bannerText}>🚗 Ride in progress</Text>
          </View>

          <View style={[styles.inProgressPill, { alignSelf: 'flex-start' }]}>
            <Text style={styles.inProgressText}>
              {ride.booking_type === 'full_day' ? 'Full Day Hire In Progress' : 'On Your Way'}
            </Text>
          </View>

          {driverProfile && (
            <View style={styles.driverCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{driverName.charAt(0).toUpperCase() || '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.driverName}>{driverName}</Text>
                  <TouchableOpacity onPress={toggleFavorite}>
                    <Text style={{ fontSize: 18 }}>{isFavorite ? '❤️' : '🤍'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.driverVehicle}>
                  {driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.infoCard}>
            <InfoRow label="Fare" value={formatDualCurrency(fareDisplay ?? 0)} bold />
            <InfoRow label="Payment" value={ride.payment_method ?? 'cash'} />
          </View>

          {/* Cancel is intentionally available even in_progress (emergency) */}
          <CancelBtn label="Cancel Ride (Emergency)" />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Completed ─────────────────────────────────────────────────────────────
  if (ride.status === 'completed') {
    if (!showRating) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <Text style={[styles.statusTitle, { fontSize: 22 }]}>🎉 Ride Completed!</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Pickup"      value={ride.pickup_address || '—'} />
              <InfoRow label="Destination" value={ride.destination_address || '—'} />
              <InfoRow label="Distance"    value={`${ride.distance_km?.toFixed(1)} km`} />
              <InfoRow label="Final Fare"  value={formatDualCurrency(ride.final_fare || ride.estimated_fare || 0)} bold />
              <InfoRow label="Payment"     value={ride.payment_method || '—'} />
              <InfoRow label="Driver"      value={driverName || '—'} />
            </View>
            <TouchableOpacity style={styles.navyBtn} onPress={() => setShowRating(true)}>
              <Text style={styles.navyBtnText}>Rate Your Driver ★</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => { completionFlowStarted.current = false; setRide(null); }}
            >
              <Text style={styles.outlineBtnText}>Done</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.bigTitle}>Rate Your Driver 🎉</Text>
        <Text style={styles.subText}>How was your ride with {driverName}?</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 16 }}>
          {[1, 2, 3, 4, 5].map(s => (
            <TouchableOpacity key={s} onPress={() => setRating(s)}>
              <Text style={{ fontSize: 40, color: s <= rating ? '#f59e0b' : '#d1d5db' }}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.reviewInput}
          placeholder="Optional comment…"
          placeholderTextColor="#9ca3af"
          value={review}
          onChangeText={setReview}
          multiline
        />
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.outlineBtn}
            onPress={() => { completionFlowStarted.current = false; setRide(null); setShowRating(false); }}>
            <Text style={styles.outlineBtnText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navyBtn, (rating === 0 || submittingRating) && { opacity: 0.5 }]}
            disabled={rating === 0 || submittingRating}
            onPress={handleSubmitRating}
          >
            {submittingRating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.navyBtnText}>Submit Rating</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function RideRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <Text style={{ fontSize: 14 }}>{icon}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: '#374151' }} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
      <Text style={{ fontSize: 13, color: '#6b7280' }}>{label}</Text>
      <Text style={{ fontSize: 13, color: bold ? '#1A2744' : '#111', fontWeight: bold ? '700' : '500', maxWidth: '60%', textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  bigIcon: { fontSize: 56, marginBottom: 12 },
  bigTitle: { fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  subText: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },

  // Cancel — always red, always visible
  cancelBtn: {
    borderWidth: 2,
    borderColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
    maxWidth: 380,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  cancelBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },

  // Force clear
  clearStuckBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  clearStuckText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  clearStuckHint: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6, maxWidth: 300 },

  navyBtn: { backgroundColor: '#1A2744', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center' },
  navyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn: { borderWidth: 2, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center' },
  outlineBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },

  // Pending
  pulseWrap: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pulseRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: 'rgba(26,39,68,0.25)' },
  pulseInner: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(26,39,68,0.08)', alignItems: 'center', justifyContent: 'center' },
  countdown: { fontSize: 14, fontWeight: '600', marginBottom: 16 },
  rideCard: { width: '100%', maxWidth: 380, backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardMeta: { fontSize: 12, color: '#6b7280' },

  // Active ride screens
  bannerBlue: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 14, alignItems: 'center' },
  bannerGreen: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 12, padding: 14, alignItems: 'center' },
  bannerText: { fontSize: 14, fontWeight: '600', color: '#1e40af' },
  statusTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  driverCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: '#f9fafb', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  driverName: { fontSize: 16, fontWeight: '700', color: '#111' },
  driverVehicle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  infoCard: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  inProgressPill: { backgroundColor: '#1A2744', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  inProgressText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Rating
  reviewInput: { width: '100%', maxWidth: 380, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14, color: '#111', minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
});
