import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

const SCREEN_H = Dimensions.get('window').height;
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { RidesAPI, FavoritesAPI, DriversAPI } from '@/lib/api';
import { formatDualCurrency } from '@/lib/currency';
import RideMap from '@/components/ride/RideMap';
import ChatModal from '@/components/ChatModal';
import { SymbolView } from 'expo-symbols';
import { Ride } from '@/types';

export default function MyRideScreen() {
  const { user } = useAuth();
  const [ride, setRide]             = useState<Ride | null>(null);
  const [loading, setLoading]       = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [eta, setEta]               = useState<number | null>(null);
  const [pendingTimedOut, setPendingTimedOut]           = useState(false);
  const [pendingSecondsLeft, setPendingSecondsLeft]     = useState<number | null>(null);
  const [driverCancelledRide, setDriverCancelledRide]   = useState<Ride | null>(null);
  const [rating, setRating]         = useState(0);
  const [review, setReview]         = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [clearingStuck, setClearingStuck] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const activeRideIdRef       = useRef<string | null>(null);
  const completionFlowStarted = useRef(false);
  const lastKnownStatusRef    = useRef<string | null>(null);
  const pendingTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCountdownRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch active ride ─────────────────────────────────────────────────────
  const fetchActiveRide = useCallback(async () => {
    if (!user) return;

    const activeRide = await RidesAPI.getActive();

    if (activeRide?.status === 'completed') {
      if (completionFlowStarted.current || activeRideIdRef.current === activeRide.id) {
        completionFlowStarted.current = true;
        lastKnownStatusRef.current = 'completed';
        setRide(activeRide);
      }
    } else if (completionFlowStarted.current) {
      // keep post-ride flow
    } else if (!activeRide) {
      const knownId    = activeRideIdRef.current;
      const wasMatched = ['matched', 'arrived', 'in_progress'].includes(lastKnownStatusRef.current ?? '');

      if (knownId && wasMatched) {
        const cancelledRide = await RidesAPI.getById(knownId);
        const byPassenger   = cancelledRide?.cancellation_reason?.toLowerCase().includes('passenger');

        if (cancelledRide?.status === 'cancelled' && !byPassenger) {
          setDriverCancelledRide(cancelledRide);
        } else if (!cancelledRide || (cancelledRide.status === 'cancelled' && !byPassenger)) {
          setDriverCancelledRide({ id: knownId, status: 'cancelled' } as Ride);
        } else {
          setDriverCancelledRide(null);
        }
      } else {
        setDriverCancelledRide(null);
      }
      setRide(null);
      activeRideIdRef.current = null;
      lastKnownStatusRef.current = null;
    } else {
      setDriverCancelledRide(null);
      setRide(activeRide);
      activeRideIdRef.current = activeRide.id;
      lastKnownStatusRef.current = activeRide.status;

      if (activeRide.driver_id) {
        const driverInfo = await DriversAPI.get(activeRide.driver_id);
        setDriverName(driverInfo.full_name || 'Driver');
        setDriverProfile(driverInfo.driver_profile);
        const { isFavorite } = await FavoritesAPI.check(activeRide.driver_id);
        setIsFavorite(isFavorite);
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchActiveRide();
    const interval = setInterval(fetchActiveRide, 3000);
    const channel  = supabase
      .channel(`pax-ride-${user?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `passenger_id=eq.${user?.id}` }, () => fetchActiveRide())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [fetchActiveRide]);

  // 3-min pending timeout
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

  useEffect(() => {
    if (!pendingTimedOut || !ride || ride.status !== 'pending') return;
    const t = setTimeout(async () => {
      const rideData = await RidesAPI.getById(ride.id);
      if (rideData?.status === 'pending') {
        await RidesAPI.cancel(ride.id, 'No driver available (timeout)');
        activeRideIdRef.current = null; setRide(null); setPendingTimedOut(false);
      }
    }, 60 * 1000);
    return () => clearTimeout(t);
  }, [pendingTimedOut, ride]);

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
      const r = getLeft(); setPendingSecondsLeft(r);
      if (r <= 0) { clearInterval(pendingCountdownRef.current!); pendingCountdownRef.current = null; }
    }, 1000);
    return () => { if (pendingCountdownRef.current) clearInterval(pendingCountdownRef.current); };
  }, [ride?.id, ride?.status, ride?.booking_type, ride?.created_at, pendingTimedOut]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const cancelRide = async () => {
    if (!ride) return;
    setCancelling(true);
    await RidesAPI.cancel(ride.id, 'Cancelled by passenger');
    activeRideIdRef.current = null; completionFlowStarted.current = false;
    setRide(null); setPendingTimedOut(false); setCancelling(false);
  };

  const clearStuckRides = async () => {
    if (!user) return;
    setClearingStuck(true);
    await RidesAPI.clearStuck();
    setClearingStuck(false);
    fetchActiveRide();
  };

  const retryRide = async () => {
    if (!ride) return;
    try {
      const newRide = await RidesAPI.retry(ride.id);
      setPendingTimedOut(false); setRide(newRide); activeRideIdRef.current = newRide.id;
    } catch {}
  };

  const toggleFavorite = async () => {
    if (!ride?.driver_id) return;
    if (isFavorite) {
      await FavoritesAPI.remove(ride.driver_id);
      setIsFavorite(false);
    } else {
      await FavoritesAPI.add(ride.driver_id);
      setIsFavorite(true);
    }
  };

  const submitRating = async () => {
    if (!ride || rating === 0 || !ride.driver_id) return;
    setSubmittingRating(true);
    await RidesAPI.rate(ride.id, ride.driver_id, rating, review);
    setSubmittingRating(false); completionFlowStarted.current = false; setRide(null); setShowRating(false);
  };

  // ── Shared cancel button ──────────────────────────────────────────────────
  const CancelBtn = ({ label = 'Cancel Ride' }: { label?: string }) => (
    <TouchableOpacity style={[styles.cancelBtn, cancelling && { opacity: 0.5 }]} onPress={cancelRide} disabled={cancelling}>
      {cancelling
        ? <ActivityIndicator color="#ef4444" size="small" />
        : <Text style={styles.cancelBtnText}>{label}</Text>
      }
    </TouchableOpacity>
  );

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#1A2744" /></SafeAreaView>;

  if (driverCancelledRide) {
    const hasRoute = !!(driverCancelledRide.pickup_address && driverCancelledRide.destination_address);

    const handleRebook = async () => {
      if (!hasRoute) { router.replace('/(tabs)'); return; }
      const r = driverCancelledRide;
      try {
        const newRide = await RidesAPI.book({
          pickup_address: r.pickup_address, pickup_lat: r.pickup_lat, pickup_lng: r.pickup_lng,
          destination_address: r.destination_address, destination_lat: r.destination_lat, destination_lng: r.destination_lng,
          distance_km: r.distance_km, duration_minutes: r.duration_minutes, estimated_fare: r.estimated_fare,
          vehicle_type: r.vehicle_type, ride_type: r.ride_type ?? 'private', booking_type: r.booking_type ?? 'standard',
          payment_method: r.payment_method ?? 'cash', status: 'pending',
        } as any);
        setDriverCancelledRide(null);
        setRide(newRide);
        activeRideIdRef.current = newRide.id;
        lastKnownStatusRef.current = 'pending';
      } catch {}
    };

    return (
      <SafeAreaView style={[styles.center, { gap: 0 }]}>
        <View style={styles.cancelledIconBox}>
          <Text style={{ fontSize: 36 }}>😔</Text>
        </View>
        <Text style={styles.bigTitle}>Driver Cancelled</Text>
        <Text style={styles.subText}>Your driver cancelled the ride.{'\n'}Sorry for the inconvenience.</Text>

        {hasRoute && (
          <View style={[styles.rideCard, { width: '100%', marginBottom: 20 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#22c55e' }} />
              <Text style={{ flex: 1, fontSize: 13, color: '#374151' }} numberOfLines={1}>{driverCancelledRide.pickup_address}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#ef4444' }} />
              <Text style={{ flex: 1, fontSize: 13, color: '#374151' }} numberOfLines={1}>{driverCancelledRide.destination_address}</Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={[styles.navyBtn, { width: '100%', marginBottom: 10 }]} onPress={handleRebook}>
          <Text style={styles.navyBtnText}>{hasRoute ? 'Rebook Same Ride →' : 'Book a New Ride →'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.outlineBtn, { width: '100%' }]} onPress={() => setDriverCancelledRide(null)}>
          <Text style={styles.outlineBtnText}>Dismiss</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── No Drivers Available ─────────────────────────────────────────────────
  if (ride?.status === 'no_drivers') {
    return (
      <SafeAreaView style={styles.center}>
        <View style={[styles.jihLogo, { borderColor: '#ef4444', shadowColor: '#ef4444' }]}>
          <Feather name="map-pin" size={36} color="#ef4444" />
        </View>
        <Text style={styles.bigTitle}>No Drivers Nearby</Text>
        <Text style={styles.subText}>
          No drivers are available within range right now.{'\n'}Try again in a few minutes.
        </Text>
        <TouchableOpacity
          style={styles.navyBtn}
          onPress={async () => {
            try {
              const newRide = await RidesAPI.retry(ride.id);
              setRide(newRide);
              activeRideIdRef.current = newRide.id;
            } catch { /* ignore */ }
          }}
        >
          <Text style={styles.navyBtnText}>Try Again →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.outlineBtn, { marginTop: 8 }]}
          onPress={async () => {
            await RidesAPI.cancel(ride.id, 'No drivers found');
            setRide(null);
          }}
        >
          <Text style={styles.outlineBtnText}>Cancel</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.jihLogo}>
          <Text style={styles.jihLogoText}>Jih</Text>
        </View>
        <Text style={styles.bigTitle}>No Active Ride</Text>
        <Text style={styles.subText}>Book a ride from the Book tab to get started.</Text>
        <TouchableOpacity style={styles.navyBtn} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.navyBtnText}>Book a Ride →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.clearBtn, clearingStuck && { opacity: 0.5 }]} onPress={clearStuckRides} disabled={clearingStuck}>
          {clearingStuck
            ? <ActivityIndicator color="#6b7280" size="small" />
            : <><Feather name="tool" size={13} color="#6b7280" /><Text style={styles.clearBtnText}> Clear stuck rides</Text></>}
        </TouchableOpacity>
        <Text style={styles.clearHint}>Use if booking says you have an active ride but nothing shows here.</Text>
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
          <View style={styles.row}>
            <CancelBtn label="Cancel" />
            <TouchableOpacity style={styles.navyBtn} onPress={retryRide}><Text style={styles.navyBtnText}>Try Again</Text></TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.pulseWrap}>
          <View style={styles.pulseRing} />
          <View style={styles.pulseInner}><ActivityIndicator size="large" color="#1A2744" /></View>
        </View>
        <Text style={styles.bigTitle}>{isFullDay ? 'Looking for a driver for your offer…' : 'Looking for a driver…'}</Text>
        {pendingSecondsLeft !== null && !isFullDay && (
          <Text style={[styles.countdown, pendingSecondsLeft <= 30 ? { color: '#ef4444' } : pendingSecondsLeft <= 60 ? { color: '#f59e0b' } : { color: '#6b7280' }]}>
            {pendingSecondsLeft <= 10 ? 'Cancelling soon…' : `${Math.floor(pendingSecondsLeft / 60)}:${String(pendingSecondsLeft % 60).padStart(2, '0')} remaining`}
          </Text>
        )}
        <View style={styles.rideCard}>
          <RideCardRow icon="📍" text={ride.pickup_address || 'Pickup'} />
          {!isFullDay && <RideCardRow icon="🏁" text={ride.destination_address || 'Destination'} />}
          {isFullDay && ride.hire_description && <Text style={styles.meta}>{ride.hire_description}</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, marginTop: 4 }}>
            <Text style={styles.meta}>{ride.vehicle_type}</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A2744' }}>${(isFullDay ? ride.offered_fare : ride.estimated_fare)?.toFixed(2)}</Text>
          </View>
        </View>
        <CancelBtn />
      </SafeAreaView>
    );
  }

  // ── Matched / Arrived ─────────────────────────────────────────────────────
  if (ride.status === 'matched' || ride.status === 'arrived') {
    const fareDisplay = ride.booking_type === 'full_day' ? (ride.agreed_price || ride.offered_fare) : ride.estimated_fare;
    const safeDestLat = ride.destination_lat ?? ride.pickup_lat ?? 11.5564;
    const safeDestLng = ride.destination_lng ?? ride.pickup_lng ?? 104.9282;

    return (
      <View style={{ flex: 1 }}>
        {/* ── Full-screen map ── */}
        <View style={StyleSheet.absoluteFill}>
          <RideMap
            pickupLat={ride.pickup_lat ?? 11.5564}
            pickupLng={ride.pickup_lng ?? 104.9282}
            destLat={safeDestLat}
            destLng={safeDestLng}
            driverId={ride.driver_id ?? null}
            rideStatus={ride.status}
            vehicleType={ride.vehicle_type}
            onEtaUpdate={setEta}
          />
        </View>

        {/* ── ETA pill pinned to top ── */}
        <SafeAreaView pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <View style={styles.etaPill}>
            <Text style={styles.etaPillText}>
              {ride.status === 'arrived'
                ? '✓ Driver arrived!'
                : eta != null ? `Driver ~${eta} min away` : 'Driver on the way…'}
            </Text>
          </View>
        </SafeAreaView>

        {/* ── Scrollable bottom sheet ── */}
        <View style={styles.rideSheet}>
          <View style={styles.sheetHandle} />
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.statusTitle}>{ride.status === 'matched' ? 'Driver Found!' : 'Driver Arrived!'}</Text>
              <View style={[styles.inProgressPill, ride.status === 'arrived' && { backgroundColor: '#166534' }]}>
                <Text style={styles.inProgressTxt}>{ride.status === 'arrived' ? 'Arrived' : 'On the way'}</Text>
              </View>
            </View>

            {/* Driver card */}
            <View style={styles.driverCard}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{driverName.charAt(0).toUpperCase() || '?'}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.driverName}>{driverName || 'Your Driver'}</Text>
                  <TouchableOpacity onPress={toggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <SymbolView
                      name={isFavorite ? 'heart.fill' : 'heart'}
                      style={{ width: 18, height: 18 }}
                      tintColor={isFavorite ? '#ef4444' : '#9ca3af'}
                      resizeMode="scaleAspectFit"
                    />
                  </TouchableOpacity>
                </View>
                {driverProfile && (
                  <>
                    <Text style={styles.driverVehicle}>{driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {driverProfile.is_id_verified  && <Chip color="#166534" bg="#dcfce7">✓ ID Verified</Chip>}
                      {driverProfile.speaks_english   && <Chip color="#1d4ed8" bg="#dbeafe">English</Chip>}
                      {driverProfile.tourist_friendly && <Chip color="#6d28d9" bg="#ede9fe">Tourist Friendly</Chip>}
                    </View>
                  </>
                )}
                <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                  {ride.status === 'matched' ? 'On the way to you…' : 'Waiting at pickup location'}
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <InfoRow label="Distance" value={`${ride.distance_km?.toFixed(1)} km`} />
              <InfoRow label="Duration" value={`${ride.duration_minutes} min`} />
              <InfoRow label="Fare"     value={formatDualCurrency(fareDisplay ?? 0)} bold />
              <InfoRow label="Payment"  value={ride.payment_method ?? 'cash'} />
            </View>

            <TouchableOpacity style={styles.chatBtn} onPress={() => setShowChat(true)}>
              <SymbolView name="bubble.left.fill" style={{ width: 18, height: 18 }} tintColor="#1A2744" resizeMode="scaleAspectFit" />
              <Text style={styles.chatBtnText}>Message Driver</Text>
            </TouchableOpacity>

            <CancelBtn />
          </ScrollView>
        </View>

        <ChatModal visible={showChat} onClose={() => setShowChat(false)}
          rideId={ride.id} driverName={driverName || 'Driver'} />
      </View>
    );
  }

  // ── In progress ───────────────────────────────────────────────────────────
  if (ride.status === 'in_progress') {
    const fareDisplay = ride.booking_type === 'full_day' ? (ride.agreed_price || ride.offered_fare) : ride.estimated_fare;
    const safeDestLat = ride.destination_lat ?? ride.pickup_lat ?? 11.5564;
    const safeDestLng = ride.destination_lng ?? ride.pickup_lng ?? 104.9282;

    return (
      <View style={{ flex: 1 }}>
        {/* ── Full-screen map ── */}
        <View style={StyleSheet.absoluteFill}>
          <RideMap
            pickupLat={ride.pickup_lat ?? 11.5564}
            pickupLng={ride.pickup_lng ?? 104.9282}
            destLat={safeDestLat}
            destLng={safeDestLng}
            driverId={ride.driver_id ?? null}
            rideStatus="in_progress"
            vehicleType={ride.vehicle_type}
            onEtaUpdate={setEta}
          />
        </View>

        {/* ── ETA pill ── */}
        <SafeAreaView pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <View style={styles.etaPill}>
            <Text style={styles.etaPillText}>
              {eta != null ? `~${eta} min to destination` : 'Ride in progress'}
            </Text>
          </View>
        </SafeAreaView>

        {/* ── Scrollable bottom sheet ── */}
        <View style={styles.rideSheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.statusTitle}>{ride.booking_type === 'full_day' ? 'Full Day Hire' : 'Ride in Progress'}</Text>
              <View style={styles.inProgressPill}>
                <Text style={styles.inProgressTxt}>In Progress</Text>
              </View>
            </View>

            {driverProfile && (
              <View style={styles.driverCard}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{driverName.charAt(0).toUpperCase() || '?'}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.driverName}>{driverName}</Text>
                    <TouchableOpacity onPress={toggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <SymbolView
                        name={isFavorite ? 'heart.fill' : 'heart'}
                        style={{ width: 18, height: 18 }}
                        tintColor={isFavorite ? '#ef4444' : '#9ca3af'}
                        resizeMode="scaleAspectFit"
                      />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.driverVehicle}>{driverProfile.vehicle_color} {driverProfile.vehicle_brand} · {driverProfile.plate_number}</Text>
                </View>
              </View>
            )}

            <View style={styles.infoCard}>
              <InfoRow label="Fare"    value={formatDualCurrency(fareDisplay ?? 0)} bold />
              <InfoRow label="Payment" value={ride.payment_method ?? 'cash'} />
            </View>

            <TouchableOpacity style={styles.chatBtn} onPress={() => setShowChat(true)}>
              <SymbolView name="bubble.left.fill" style={{ width: 18, height: 18 }} tintColor="#1A2744" resizeMode="scaleAspectFit" />
              <Text style={styles.chatBtnText}>Message Driver</Text>
            </TouchableOpacity>

            <CancelBtn label="Cancel Ride (Emergency)" />
          </ScrollView>
        </View>

        <ChatModal visible={showChat} onClose={() => setShowChat(false)}
          rideId={ride.id} driverName={driverName || 'Driver'} />
      </View>
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
            <TouchableOpacity style={styles.navyBtn} onPress={() => setShowRating(true)}><Text style={styles.navyBtnText}>Rate Your Driver ★</Text></TouchableOpacity>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => { completionFlowStarted.current = false; setRide(null); }}><Text style={styles.outlineBtnText}>Done</Text></TouchableOpacity>
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
        <TextInput style={styles.reviewInput} placeholder="Optional comment…" placeholderTextColor="#9ca3af" value={review} onChangeText={setReview} multiline />
        <View style={styles.row}>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => { completionFlowStarted.current = false; setRide(null); setShowRating(false); }}>
            <Text style={styles.outlineBtnText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navyBtn, (rating === 0 || submittingRating) && { opacity: 0.5 }]} disabled={rating === 0 || submittingRating} onPress={submitRating}>
            {submittingRating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.navyBtnText}>Submit Rating</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function RideCardRow({ icon, text }: { icon: string; text: string }) {
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
      <Text style={{ fontSize: 13, color: bold ? '#1A2744' : '#111', fontWeight: bold ? '700' : '500', maxWidth: '60%', textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function Chip({ color, bg, children }: { color: string; bg: string; children: string }) {
  return (
    <Text style={{ fontSize: 11, color, backgroundColor: bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' }}>
      {children}
    </Text>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  jihLogo:      { width: 90, height: 90, borderRadius: 20, backgroundColor: '#0D1B36', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#7BB8D9', shadowColor: '#7BB8D9', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8, marginBottom: 16 },
  jihLogoText:  { fontSize: 38, fontWeight: '900', color: '#ffffff', letterSpacing: -1 },
  bigIcon:      { fontSize: 56, marginBottom: 12 },
  cancelledIconBox: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fef2f2', borderWidth: 2, borderColor: '#fecaca', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  bigTitle:     { fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  subText:      { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
  row:          { flexDirection: 'row', gap: 12, marginTop: 12 },

  // Map
  mapBox:       { height: 280, position: 'relative' },
  etaPill:      { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 12, padding: 12, alignItems: 'center', boxShadow: '0px 2px 8px rgba(0,0,0,0.15)' } as any,
  etaPillText:  { fontSize: 14, fontWeight: '700', color: '#1A2744' },
  infoScroll:   { padding: 16, gap: 12, paddingBottom: 32 },

  // Pending
  pulseWrap:    { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  pulseRing:    { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: 'rgba(26,39,68,0.25)' },
  pulseInner:   { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(26,39,68,0.08)', alignItems: 'center', justifyContent: 'center' },
  countdown:    { fontSize: 14, fontWeight: '600', marginBottom: 16 },
  rideCard:     { width: '100%', maxWidth: 380, backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  meta:         { fontSize: 12, color: '#6b7280' },

  // Driver / info
  statusTitle:  { fontSize: 20, fontWeight: '700', color: '#111' },
  driverCard:   { flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: '#f9fafb', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  avatar:       { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:    { color: '#fff', fontSize: 20, fontWeight: '700' },
  driverName:   { fontSize: 16, fontWeight: '700', color: '#111' },
  driverVehicle:{ fontSize: 13, color: '#6b7280', marginTop: 2 },
  infoCard:     { backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  inProgressPill: { backgroundColor: '#1A2744', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
  inProgressTxt: { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Buttons
  cancelBtn:    { borderWidth: 2, borderColor: '#ef4444', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  cancelBtnText:{ color: '#ef4444', fontWeight: '700', fontSize: 15 },
  navyBtn:      { backgroundColor: '#1A2744', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center' },
  navyBtnText:  { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn:   { borderWidth: 2, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 13, alignItems: 'center' },
  outlineBtnText:{ color: '#374151', fontWeight: '600', fontSize: 14 },
  clearBtn:     { marginTop: 20, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  clearBtnText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  clearHint:    { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 6, maxWidth: 300 },

  // Rating
  reviewInput:  { width: '100%', maxWidth: 380, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14, color: '#111', minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
  chatBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#1A2744', borderRadius: 10, paddingVertical: 13, backgroundColor: '#fff' },
  chatBtnText:  { color: '#1A2744', fontWeight: '700', fontSize: 14 },

  // ── Bottom sheet ──
  rideSheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: SCREEN_H * 0.52,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetHandle: {
    width: 40, height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetContent: { padding: 16, paddingBottom: 36, gap: 12 },
});
