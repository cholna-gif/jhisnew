import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatDualCurrency, formatUsd } from '@/lib/currency';
import { Ride } from '@/types';

export default function MyRideScreen() {
  const { user } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverName, setDriverName] = useState('');
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [pendingSecondsLeft, setPendingSecondsLeft] = useState<number | null>(null);
  const [driverCancelledRide, setDriverCancelledRide] = useState<Ride | null>(null);
  const activeRideIdRef = useRef<string | null>(null);
  const completionFlowStarted = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchActiveRide = async () => {
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
      // stay in post-ride flow
    } else {
      if (!activeRide) {
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
      } else {
        setDriverCancelledRide(null);
        setRide(activeRide);
        activeRideIdRef.current = activeRide.id;

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
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchActiveRide();
    const interval = setInterval(fetchActiveRide, 3000);

    const channel = supabase
      .channel(`passenger-ride-${user?.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rides',
        filter: `passenger_id=eq.${user?.id}`,
      }, () => fetchActiveRide())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // 3-minute timeout for pending rides
  useEffect(() => {
    if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    if (ride?.status === 'pending' && !pendingTimedOut) {
      const elapsed = ride.created_at ? Date.now() - new Date(ride.created_at).getTime() : 0;
      const remaining = Math.max(0, 3 * 60 * 1000 - elapsed);
      pendingTimerRef.current = setTimeout(() => setPendingTimedOut(true), remaining);
    }
    if (ride?.status && ride.status !== 'pending') setPendingTimedOut(false);
    return () => { if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); };
  }, [ride?.id, ride?.status, ride?.created_at, pendingTimedOut]);

  // Auto-cancel after timeout
  useEffect(() => {
    if (!pendingTimedOut || !ride || ride.status !== 'pending') return;
    const timer = setTimeout(async () => {
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
    return () => clearTimeout(timer);
  }, [pendingTimedOut, ride]);

  // Countdown timer
  useEffect(() => {
    if (pendingCountdownRef.current) { clearInterval(pendingCountdownRef.current); pendingCountdownRef.current = null; }
    setPendingSecondsLeft(null);
    if (ride?.status !== 'pending' || ride?.booking_type === 'full_day' || pendingTimedOut) return;
    const TIMEOUT_MS = 3 * 60 * 1000;
    const getRemaining = () => {
      const elapsed = ride.created_at ? Date.now() - new Date(ride.created_at).getTime() : 0;
      return Math.max(0, Math.floor((TIMEOUT_MS - elapsed) / 1000));
    };
    setPendingSecondsLeft(getRemaining());
    pendingCountdownRef.current = setInterval(() => {
      const r = getRemaining();
      setPendingSecondsLeft(r);
      if (r <= 0) { clearInterval(pendingCountdownRef.current!); pendingCountdownRef.current = null; }
    }, 1000);
    return () => { if (pendingCountdownRef.current) clearInterval(pendingCountdownRef.current); };
  }, [ride?.id, ride?.status, ride?.booking_type, ride?.created_at, pendingTimedOut]);

  const handleCancelRide = async () => {
    if (!ride) return;
    Alert.alert('Cancel Ride', 'Are you sure you want to cancel?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('rides' as any).update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: 'Cancelled by passenger',
          } as any).eq('id', ride.id);
          activeRideIdRef.current = null;
          completionFlowStarted.current = false;
          setRide(null);
          setPendingTimedOut(false);
        },
      },
    ]);
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
      pickup_address: ride.pickup_address,
      pickup_lat: ride.pickup_lat,
      pickup_lng: ride.pickup_lng,
      destination_address: ride.destination_address,
      destination_lat: ride.destination_lat,
      destination_lng: ride.destination_lng,
      distance_km: ride.distance_km,
      duration_minutes: ride.duration_minutes,
      estimated_fare: ride.estimated_fare,
      offered_fare: ride.offered_fare,
      vehicle_type: ride.vehicle_type,
      ride_type: ride.ride_type,
      booking_type: ride.booking_type,
      hire_description: ride.hire_description,
      group_size: ride.group_size,
      payment_method: ride.payment_method,
      status: 'pending',
    } as any).select().single() as any;

    if (error) {
      Alert.alert('Error', 'Could not retry. Please book again.');
      setRide(null); setPendingTimedOut(false); return;
    }
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
      await supabase.from('notifications').insert({
        user_id: ride.driver_id,
        title: 'New Favorite!',
        message: 'A passenger saved you as a favorite driver!',
        type: 'favorite_added',
      });
    }
  };

  const handleSubmitRating = async () => {
    if (!ride || rating === 0) return;
    setSubmittingRating(true);
    await supabase.from('rides' as any).update({ driver_rating: rating, driver_review: review } as any).eq('id', ride.id);
    if (ride.driver_id) {
      await supabase.from('ride_ratings').insert({
        ride_id: ride.id,
        rater_id: user!.id,
        rated_id: ride.driver_id,
        rating,
        review,
        rated_as: 'driver',
      });
      const { data: allRatings } = await supabase.from('ride_ratings').select('rating').eq('rated_id', ride.driver_id).eq('rated_as', 'driver');
      if (allRatings && allRatings.length > 0) {
        const avg = allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length;
        await supabase.from('driver_profiles' as any).update({ average_rating: parseFloat(avg.toFixed(2)) } as any).eq('user_id', ride.driver_id);
      }
    }
    setSubmittingRating(false);
    completionFlowStarted.current = false;
    setRide(null);
    setShowRating(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#1A2744" />
      </SafeAreaView>
    );
  }

  // Driver cancelled
  if (driverCancelledRide) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.bigIcon}>😔</Text>
        <Text style={styles.bigTitle}>Your driver cancelled</Text>
        <Text style={styles.subText}>We're sorry for the inconvenience.</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => setDriverCancelledRide(null)}>
            <Text style={styles.outlineBtnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // No active ride
  if (!ride) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.bigIcon}>🛺</Text>
        <Text style={styles.bigTitle}>No Active Ride</Text>
        <Text style={styles.subText}>Book a ride from the Book tab to get started.</Text>
      </SafeAreaView>
    );
  }

  // Pending
  if (ride.status === 'pending') {
    const isFullDay = ride.booking_type === 'full_day';

    if (pendingTimedOut && !isFullDay) {
      return (
        <SafeAreaView style={styles.center}>
          <Text style={styles.bigIcon}>⏰</Text>
          <Text style={styles.bigTitle}>No drivers nearby</Text>
          <Text style={styles.subText}>Try again in a few minutes.</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.outlineBtn} onPress={handleCancelRide}>
              <Text style={styles.outlineBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleTryAgain}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.pingOuter}>
          <View style={styles.pingInner}>
            <ActivityIndicator size="large" color="#1A2744" />
          </View>
        </View>
        <Text style={styles.bigTitle}>
          {isFullDay ? 'Looking for a driver to accept your offer...' : 'Looking for a driver...'}
        </Text>
        {pendingSecondsLeft !== null && !isFullDay && (
          <Text style={[
            styles.countdown,
            pendingSecondsLeft <= 30 ? styles.countdownRed : pendingSecondsLeft <= 60 ? styles.countdownAmber : styles.countdownGray
          ]}>
            {pendingSecondsLeft <= 10
              ? 'Ride cancelling soon...'
              : `${Math.floor(pendingSecondsLeft / 60)}:${String(pendingSecondsLeft % 60).padStart(2, '0')} remaining`}
          </Text>
        )}
        <View style={styles.rideCard}>
          <View style={styles.cardRow}><Text style={styles.cardIcon}>📍</Text><Text style={styles.cardText} numberOfLines={1}>{ride.pickup_address}</Text></View>
          {!isFullDay && ride.destination_address && (
            <View style={styles.cardRow}><Text style={styles.cardIcon}>🏁</Text><Text style={styles.cardText} numberOfLines={1}>{ride.destination_address}</Text></View>
          )}
          {isFullDay && ride.hire_description && (
            <Text style={styles.cardMeta}>{ride.hire_description}</Text>
          )}
          <View style={[styles.cardRow, styles.cardRowBorder]}>
            <Text style={styles.cardMeta}>{ride.vehicle_type}</Text>
            <Text style={styles.cardFare}>${(isFullDay ? ride.offered_fare : ride.estimated_fare)?.toFixed(2)}</Text>
          </View>
        </View>
        <TouchableOpacity style={[styles.outlineBtn, { marginTop: 16, borderColor: '#ef4444' }]} onPress={handleCancelRide}>
          <Text style={[styles.outlineBtnText, { color: '#ef4444' }]}>Cancel Ride</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Matched / Arrived
  if (ride.status === 'matched' || ride.status === 'arrived') {
    const fareDisplay = ride.booking_type === 'full_day'
      ? (ride.agreed_price || ride.offered_fare)
      : ride.estimated_fare;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={[
            styles.etaBanner,
            ride.status === 'arrived' ? styles.etaBannerArrived : styles.etaBannerOnWay
          ]}>
            <Text style={styles.etaText}>
              {ride.status === 'arrived' ? '✅ Your driver has arrived' : '🛺 Driver on the way…'}
            </Text>
          </View>

          <Text style={styles.statusTitle}>
            {ride.status === 'matched' ? 'Driver Found!' : 'Driver Arrived!'}
          </Text>

          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverInitial}>{driverName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.driverName}>{driverName}</Text>
                <TouchableOpacity onPress={toggleFavorite}>
                  <Text style={styles.heartIcon}>{isFavorite ? '❤️' : '🤍'}</Text>
                </TouchableOpacity>
              </View>
              {driverProfile && (
                <>
                  <Text style={styles.driverVehicle}>
                    {driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}
                  </Text>
                  <View style={styles.badgeRow}>
                    {driverProfile.is_id_verified && <Text style={styles.badge}>✓ ID Verified</Text>}
                    {driverProfile.speaks_english && <Text style={styles.badgeBlue}>🗣 English</Text>}
                    {driverProfile.tourist_friendly && <Text style={styles.badgePurple}>🌍 Tourist Friendly</Text>}
                  </View>
                </>
              )}
              <Text style={styles.driverStatus}>
                {ride.status === 'matched' ? 'On the way to you...' : 'Waiting at pickup location'}
              </Text>
            </View>
          </View>

          <View style={styles.rideInfoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{ride.distance_km?.toFixed(1)} km</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Duration</Text>
              <Text style={styles.infoValue}>{ride.duration_minutes} min</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Fare</Text>
              <Text style={[styles.infoValue, { fontWeight: '700', color: '#1A2744' }]}>{formatDualCurrency(fareDisplay ?? 0)}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.outlineBtn, { borderColor: '#ef4444', alignSelf: 'stretch' }]}
            onPress={handleCancelRide}
          >
            <Text style={[styles.outlineBtnText, { color: '#ef4444' }]}>Cancel Ride</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // In progress
  if (ride.status === 'in_progress') {
    const fareDisplay = ride.booking_type === 'full_day'
      ? (ride.agreed_price || ride.offered_fare)
      : ride.estimated_fare;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={styles.etaBannerOnWay}>
            <Text style={styles.etaText}>🚗 On your way to destination</Text>
          </View>
          <View style={styles.inProgressPill}>
            <Text style={styles.inProgressText}>
              {ride.booking_type === 'full_day' ? 'Full Day Hire In Progress' : 'Ride in Progress'}
            </Text>
          </View>
          {driverProfile && (
            <View style={styles.driverCard}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverInitial}>{driverName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.driverName}>{driverName}</Text>
                  <TouchableOpacity onPress={toggleFavorite}>
                    <Text style={styles.heartIcon}>{isFavorite ? '❤️' : '🤍'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.driverVehicle}>
                  {driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}
                </Text>
              </View>
            </View>
          )}
          <View style={styles.rideInfoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Fare</Text>
              <Text style={[styles.infoValue, { fontWeight: '700', color: '#1A2744' }]}>{formatDualCurrency(fareDisplay ?? 0)}</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Completed — Rating flow
  if (ride.status === 'completed') {
    if (!showRating) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text style={styles.statusTitle}>🎉 Ride Completed!</Text>
            <View style={styles.rideInfoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Pickup</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{ride.pickup_address}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Destination</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{ride.destination_address}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Distance</Text>
                <Text style={styles.infoValue}>{ride.distance_km?.toFixed(1)} km</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Final Fare</Text>
                <Text style={[styles.infoValue, { fontWeight: '700', color: '#1A2744' }]}>
                  {formatDualCurrency(ride.final_fare || ride.estimated_fare || 0)}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Payment</Text>
                <Text style={styles.infoValue}>{ride.payment_method}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Driver</Text>
                <Text style={styles.infoValue}>{driverName}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setShowRating(true)}
            >
              <Text style={styles.primaryBtnText}>Rate Your Driver</Text>
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
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map(s => (
            <TouchableOpacity key={s} onPress={() => setRating(s)}>
              <Text style={[styles.star, s <= rating && styles.starActive]}>★</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.reviewInput}
          placeholder="Optional comment..."
          placeholderTextColor="#9ca3af"
          value={review}
          onChangeText={setReview}
          multiline
        />
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => { completionFlowStarted.current = false; setRide(null); setShowRating(false); }}>
            <Text style={styles.outlineBtnText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, (rating === 0 || submittingRating) && styles.btnDisabled]}
            disabled={rating === 0 || submittingRating}
            onPress={handleSubmitRating}
          >
            {submittingRating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.primaryBtnText}>Submit Rating</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  bigIcon: { fontSize: 56, marginBottom: 12 },
  bigTitle: { fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  subText: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  outlineBtn: { borderWidth: 2, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  outlineBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },
  primaryBtn: { backgroundColor: '#1A2744', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  pingOuter: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: 'rgba(26,39,68,0.3)', marginBottom: 24, alignItems: 'center', justifyContent: 'center' },
  pingInner: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(26,39,68,0.1)', alignItems: 'center', justifyContent: 'center' },
  countdown: { fontSize: 14, fontWeight: '600', marginBottom: 16 },
  countdownRed: { color: '#ef4444' },
  countdownAmber: { color: '#f59e0b' },
  countdownGray: { color: '#6b7280' },
  rideCard: { width: '100%', maxWidth: 380, backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, gap: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardRowBorder: { borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, justifyContent: 'space-between' },
  cardIcon: { fontSize: 14 },
  cardText: { flex: 1, fontSize: 13, color: '#374151' },
  cardMeta: { fontSize: 12, color: '#6b7280' },
  cardFare: { fontSize: 14, fontWeight: '700', color: '#1A2744' },
  etaBanner: { borderRadius: 12, padding: 14, alignItems: 'center' },
  etaBannerOnWay: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 14, alignItems: 'center' },
  etaBannerArrived: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 12, padding: 14, alignItems: 'center' },
  etaText: { fontSize: 14, fontWeight: '600', color: '#1e40af' },
  statusTitle: { fontSize: 20, fontWeight: '700', color: '#111' },
  driverCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: '#f9fafb', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  driverAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  driverInitial: { color: '#fff', fontSize: 20, fontWeight: '700' },
  driverName: { fontSize: 16, fontWeight: '700', color: '#111' },
  driverVehicle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  driverStatus: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  heartIcon: { fontSize: 18 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  badge: { fontSize: 11, color: '#166534', backgroundColor: '#dcfce7', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgeBlue: { fontSize: 11, color: '#1d4ed8', backgroundColor: '#dbeafe', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgePurple: { fontSize: 11, color: '#6d28d9', backgroundColor: '#ede9fe', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  rideInfoCard: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoLabel: { fontSize: 13, color: '#6b7280', flex: 1 },
  infoValue: { fontSize: 13, color: '#111', flex: 2, textAlign: 'right' },
  inProgressPill: { backgroundColor: '#1A2744', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
  inProgressText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  starsRow: { flexDirection: 'row', gap: 8, marginVertical: 16 },
  star: { fontSize: 40, color: '#d1d5db' },
  starActive: { color: '#f59e0b' },
  reviewInput: { width: '100%', maxWidth: 380, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14, color: '#111', minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
});
