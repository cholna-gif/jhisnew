import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { RidesAPI } from '@/lib/api';
import { hasActiveRide } from '@/lib/ride-guards';
import { VEHICLE_OPTIONS, calculateFare, calculateShareFare } from '@/components/booking/VehicleSelector';
import VehicleSelector from '@/components/booking/VehicleSelector';
import LocationSearch from '@/components/booking/LocationSearch';
import BookingMap from '@/components/booking/BookingMap';
import FullDayHireTab from '@/components/booking/FullDayHireTab';
import ScheduledRideTab from '@/components/booking/ScheduledRideTab';
import { formatDualCurrency, formatUsd } from '@/lib/currency';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { haversineDistance } from '@/lib/geo-utils';
import { LatLng, BookingMode, RideType } from '@/types';

const MODES: { id: BookingMode; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'full_day', label: 'Full Day' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'favorite', label: 'Favorite' },
];

const PAYMENT_OPTIONS: { id: string; label: string; symbol: SFSymbol }[] = [
  { id: 'cash',   label: 'Cash',   symbol: 'banknote.fill'    },
  { id: 'card',   label: 'Card',   symbol: 'creditcard.fill'  },
  { id: 'wallet', label: 'Wallet', symbol: 'wallet.pass.fill' },
];

type ConfirmState = 'idle' | 'checking' | 'submitting' | 'success' | 'error';

export default function BookScreen() {
  const { user, profile } = useAuth();
  const isSuspended = !!profile?.is_suspended;

  const [bookingMode, setBookingMode] = useState<BookingMode>('standard');
  const [pickup, setPickup]         = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [stops, setStops]           = useState<LatLng[]>([]);
  const [pickupText, setPickupText]   = useState('');
  const [destText, setDestText]     = useState('');
  const [stopTexts, setStopTexts]   = useState<string[]>([]);
  const [vehicleType, setVehicleType] = useState('tuktuk');
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMin, setDurationMin] = useState(0);
  const [panelOpen, setPanelOpen]   = useState(false);
  const [settingField, setSettingField] = useState<'pickup' | 'destination' | number>('pickup');
  const [rideType, setRideType]     = useState<RideType>('private');
  const [groupSize, setGroupSize]   = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [showConfirm, setShowConfirm] = useState(false);

  // Confirm screen state machine
  const [confirmState, setConfirmState] = useState<ConfirmState>('idle');
  const [confirmError, setConfirmError] = useState('');
  const [bookedRideId, setBookedRideId] = useState<string | null>(null);

  // ── Auto-navigate to My Ride when driver accepts ──────────────────────────
  // Watches the newly created ride via realtime + polling.  The moment status
  // changes away from 'pending' (driver accepted → 'matched') we jump to the
  // My Ride tab so the passenger sees the driver immediately.
  useEffect(() => {
    if (!bookedRideId || confirmState !== 'success') return;

    let navigated = false;
    const go = () => {
      if (navigated) return;
      navigated = true;
      handleGoToMyRide();
    };

    // Realtime subscription — instant notification
    const channel = supabase
      .channel(`booked-ride-${bookedRideId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${bookedRideId}`,
      }, (payload: any) => {
        const status = payload.new?.status;
        if (status && status !== 'pending' && status !== 'scheduled') go();
      })
      .subscribe();

    // Polling fallback every 3 s
    const poll = setInterval(async () => {
      const ride = await RidesAPI.getById(bookedRideId);
      const status = ride?.status;
      if (status && status !== 'pending' && status !== 'scheduled') go();
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  // handleGoToMyRide is stable (no deps change), safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookedRideId, confirmState]);

  const selectedVehicle = VEHICLE_OPTIONS.find(v => v.type === vehicleType)!;
  const isShareRide     = rideType === 'share';
  const fare            = isShareRide
    ? calculateShareFare(selectedVehicle, distanceKm)
    : calculateFare(selectedVehicle, distanceKm);
  const standardFare    = calculateFare(selectedVehicle, distanceKm);

  useEffect(() => {
    if (selectedVehicle && selectedVehicle.maxSeats < groupSize) {
      const first = VEHICLE_OPTIONS.find(v => v.maxSeats >= groupSize);
      if (first) setVehicleType(first.type);
    }
  }, [groupSize]);

  // ── Route helpers ──────────────────────────────────────────────────────────
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const d = await r.json();
      return d.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  };

  const fetchRoute = useCallback(async (p: LatLng, d: LatLng, s: LatLng[]) => {
    const wps = [p, ...s.filter(w => w.lat !== 0), d];
    const coords = wps.map(w => `${w.lng},${w.lat}`).join(';');
    try {
      const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      const data = await res.json();
      if (data.routes?.[0]) {
        const geom = data.routes[0].geometry.coordinates as [number, number][];
        setRouteCoords(geom.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
        setDistanceKm(data.routes[0].distance / 1000);
        setDurationMin(Math.round(data.routes[0].duration / 60));
        setPanelOpen(true);
      }
    } catch {
      const pts = [p, ...s.filter(w => w.lat !== 0), d];
      let dist = 0;
      for (let i = 0; i < pts.length - 1; i++) dist += haversineDistance(pts[i], pts[i + 1]);
      const road = dist * 1.3;
      setDistanceKm(road);
      setDurationMin(Math.round((road / 30) * 60));
      setRouteCoords([]);
      setPanelOpen(true);
    }
  }, []);

  const handleSetPickup = useCallback((loc: LatLng) => {
    setPickup(loc); setPickupText(loc.address);
    if (destination) fetchRoute(loc, destination, stops);
  }, [destination, stops, fetchRoute]);

  const handleSetDestination = useCallback((loc: LatLng) => {
    setDestination(loc); setDestText(loc.address);
    if (pickup) fetchRoute(pickup, loc, stops);
  }, [pickup, stops, fetchRoute]);

  const handleMapPress = useCallback(async (ll: { lat: number; lng: number }) => {
    const address = await reverseGeocode(ll.lat, ll.lng);
    const loc = { ...ll, address };
    if (settingField === 'pickup')      { handleSetPickup(loc); setSettingField('destination'); }
    else if (settingField === 'destination') { handleSetDestination(loc); }
    else if (typeof settingField === 'number') {
      const ns = [...stops]; ns[settingField] = loc; setStops(ns);
      const nt = [...stopTexts]; nt[settingField] = address; setStopTexts(nt);
      if (pickup && destination) fetchRoute(pickup, destination, ns);
    }
  }, [settingField, pickup, destination, stops, stopTexts, handleSetPickup, handleSetDestination, fetchRoute]);

  const handleGps = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission denied', 'Location permission required.'); return; }
    const pos = await Location.getCurrentPositionAsync({});
    const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    handleSetPickup({ lat: pos.coords.latitude, lng: pos.coords.longitude, address });
  }, [handleSetPickup]);

  const addStop = () => {
    if (stops.length >= 3) return;
    setStops([...stops, { lat: 0, lng: 0, address: '' }]);
    setStopTexts([...stopTexts, '']);
    setSettingField(stops.length);
  };
  const removeStop = (i: number) => {
    const ns = stops.filter((_, idx) => idx !== i);
    const nt = stopTexts.filter((_, idx) => idx !== i);
    setStops(ns); setStopTexts(nt);
    if (pickup && destination) fetchRoute(pickup, destination, ns);
  };

  // ── Open confirm screen ───────────────────────────────────────────────────
  const handleOpenConfirm = () => {
    if (isSuspended) { Alert.alert('Suspended', 'Your account has been suspended. Contact Jih support.'); return; }
    if (!pickup || !destination) { Alert.alert('Missing locations', 'Please set both pickup and destination.'); return; }
    setConfirmState('idle');
    setConfirmError('');
    setShowConfirm(true);
  };

  // ── Book ride ─────────────────────────────────────────────────────────────
  // Uses inline state (confirmState) instead of Alert so feedback is always
  // visible regardless of platform / component lifecycle.
  const handleConfirmBooking = async () => {
    // Guard: ensure we have everything we need
    if (!pickup || !destination) {
      setConfirmError('Missing pickup or destination.');
      setConfirmState('error');
      return;
    }
    if (!user) {
      setConfirmError('You are not logged in. Please restart the app and sign in again.');
      setConfirmState('error');
      return;
    }
    if (isSuspended) {
      setConfirmError('Your account has been suspended. Please contact Jih support.');
      setConfirmState('error');
      return;
    }

    setConfirmState('checking');
    setConfirmError('');

    try {
      const active = await hasActiveRide(user.id);
      if (active) {
        setConfirmError('You already have an active ride. Please complete or cancel it first.');
        setConfirmState('error');
        return;
      }
    } catch (e: any) {
      setConfirmError('Could not check for active rides. Please try again.');
      setConfirmState('error');
      return;
    }

    setConfirmState('submitting');
    const remainingSeats = isShareRide ? selectedVehicle.maxSeats - groupSize : 0;
    const pStatus        = paymentMethod === 'cash' ? 'pending' : 'paid';

    try {
      const newRide = await RidesAPI.book({
        booking_type:      'standard',
        status:            'pending',
        pickup_address:    pickup.address,
        pickup_lat:        pickup.lat,
        pickup_lng:        pickup.lng,
        destination_address: destination.address,
        destination_lat:   destination.lat,
        destination_lng:   destination.lng,
        stops:             stops.filter(s => s.lat !== 0).map(s => ({ lat: s.lat, lng: s.lng, address: s.address })),
        vehicle_type:      vehicleType,
        estimated_fare:    parseFloat(fare.toFixed(2)),
        distance_km:       parseFloat(distanceKm.toFixed(2)),
        duration_minutes:  durationMin,
        payment_method:    paymentMethod,
        payment_status:    pStatus,
        ride_type:         rideType,
        group_size:        groupSize,
        remaining_seats:   remainingSeats > 0 ? remainingSeats : null,
        shared_ride_group: isShareRide ? uuid() : null,
      } as any);
      setBookedRideId(newRide?.id ?? null);
      setConfirmState('success');
    } catch (e: any) {
      console.error('Booking exception:', e);
      setConfirmError(e?.message || 'An unexpected error occurred. Please try again.');
      setConfirmState('error');
    }
  };

  const handleGoToMyRide = () => {
    // Reset booking form
    setPickup(null); setDestination(null); setStops([]);
    setPickupText(''); setDestText(''); setStopTexts([]);
    setRouteCoords([]); setPanelOpen(false);
    setShowConfirm(false);
    setConfirmState('idle');
    // Navigate to My Ride tab
    router.replace('/(tabs)/myride');
  };

  const handleRideCreated = () => {
    setBookingMode('standard');
    setPanelOpen(false);
  };

  // ── Mode bar ──────────────────────────────────────────────────────────────
  const ModeBar = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modeBar}>
      {MODES.map(m => (
        <TouchableOpacity
          key={m.id}
          onPress={() => setBookingMode(m.id)}
          style={[styles.modeTab, bookingMode === m.id && styles.modeTabActive]}
        >
          <Text style={[styles.modeTabText, bookingMode === m.id && styles.modeTabTextActive]}>
            {m.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // CONFIRM SCREEN — shows inline states so no Alert needed
  // ══════════════════════════════════════════════════════════════════════════
  if (showConfirm) {
    // ── Success ──────────────────────────────────────────────────────────────
    if (confirmState === 'success') {
      return (
        <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
          <View style={styles.resultWrap}>
            <View style={styles.resultIconBox}>
              <Text style={styles.resultEmoji}>🛺</Text>
            </View>
            <Text style={styles.resultTitle}>Ride Requested!</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <ActivityIndicator size="small" color="#D4AF37" />
              <Text style={{ color: '#D4AF37', fontSize: 13, fontWeight: '600' }}>Searching for a driver…</Text>
            </View>
            <Text style={styles.resultBody}>
              We'll take you to My Ride automatically{'\n'}once a driver accepts.
            </Text>

            {/* Ride summary */}
            <View style={styles.summaryCard}>
              <Row label="Pickup"      value={pickupText || 'Pinned location'} />
              <Row label="Destination" value={destText   || 'Pinned location'} />
              <Row label="Vehicle"     value={selectedVehicle.label} />
              <Row label="Fare"        value={formatDualCurrency(fare)} highlight />
              <Row label="Payment"     value={{ cash:'💵 Cash', card:'💳 Card', wallet:'👛 Wallet' }[paymentMethod] ?? paymentMethod} />
            </View>

            <TouchableOpacity style={styles.goldBtn} onPress={handleGoToMyRide}>
              <Text style={styles.goldBtnText}>Track My Ride →</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    // ── Error ─────────────────────────────────────────────────────────────────
    if (confirmState === 'error') {
      return (
        <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
          <View style={styles.confirmHeader}>
            <TouchableOpacity onPress={() => { setShowConfirm(false); setConfirmState('idle'); }}>
              <Text style={styles.backBtn}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.confirmTitle}>Booking Failed</Text>
          </View>
          <View style={styles.resultWrap}>
            <View style={[styles.resultIconBox, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <Text style={styles.resultEmoji}>⚠️</Text>
            </View>
            <Text style={[styles.resultTitle, { color: '#ef4444' }]}>Something went wrong</Text>
            <Text style={[styles.resultBody, { color: 'rgba(255,255,255,0.7)' }]}>{confirmError}</Text>
            <TouchableOpacity
              style={[styles.goldBtn, { marginTop: 8 }]}
              onPress={() => { setConfirmState('idle'); setConfirmError(''); }}
            >
              <Text style={styles.goldBtnText}>Try Again</Text>
            </TouchableOpacity>
            {/* If blocked by an active ride, offer a direct link to cancel it */}
            {confirmError.toLowerCase().includes('active ride') && (
              <TouchableOpacity
                style={[styles.goldBtn, { marginTop: 10, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#D4AF37' }]}
                onPress={handleGoToMyRide}
              >
                <Text style={[styles.goldBtnText, { color: '#D4AF37' }]}>Go to My Ride → Cancel it</Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      );
    }

    // ── Idle / Loading ────────────────────────────────────────────────────────
    const isWorking = confirmState === 'checking' || confirmState === 'submitting';
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
        {/* Header */}
        <View style={styles.confirmHeader}>
          <TouchableOpacity onPress={() => setShowConfirm(false)} disabled={isWorking}>
            <Text style={[styles.backBtn, isWorking && { opacity: 0.3 }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.confirmTitle}>Confirm Booking</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {/* Route */}
          <View style={styles.confirmCard}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ alignItems: 'center', paddingTop: 4 }}>
                <View style={styles.dotGreen} />
                <View style={styles.routeLine} />
                <View style={styles.dotRed} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeAddress}>{pickupText || 'Pinned location'}</Text>
                <View style={{ height: 12 }} />
                <Text style={styles.routeLabel}>DESTINATION</Text>
                <Text style={styles.routeAddress}>{destText || 'Pinned location'}</Text>
              </View>
            </View>
          </View>

          {/* Details */}
          <View style={styles.confirmCard}>
            <Row label="Vehicle"  value={selectedVehicle.label} />
            <Row label="Ride"     value={rideType === 'share' ? `Share · ${groupSize} pax` : 'Private'} />
            <Row label="Distance" value={`${distanceKm.toFixed(1)} km · ${durationMin} min`} />
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 8 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Text style={styles.detailLabel}>Estimated fare</Text>
              <View style={{ alignItems: 'flex-end' }}>
                {isShareRide && <Text style={styles.strikeThrough}>{formatUsd(standardFare)}</Text>}
                <Text style={styles.fareGold}>{formatDualCurrency(fare)}</Text>
              </View>
            </View>
          </View>

          {/* Payment selector inline */}
          <View style={styles.confirmCard}>
            <Text style={[styles.routeLabel, { marginBottom: 10 }]}>PAYMENT METHOD</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {PAYMENT_OPTIONS.map(pm => {
                const active = paymentMethod === pm.id;
                return (
                  <TouchableOpacity
                    key={pm.id}
                    onPress={() => setPaymentMethod(pm.id)}
                    style={[styles.pmBtn, active && styles.pmBtnActive]}
                    disabled={isWorking}
                  >
                    <SymbolView name={pm.symbol} style={{ width: 14, height: 14 }} tintColor={active ? '#D4AF37' : '#9ca3af'} resizeMode="scaleAspectFit" />
                    <Text style={[styles.pmBtnText, active && { fontWeight: '700', color: '#D4AF37' }]}>
                      {pm.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Action */}
        <View style={styles.confirmFooter}>
          {isWorking ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#D4AF37" size="small" />
              <Text style={styles.loadingText}>
                {confirmState === 'checking' ? 'Checking availability…' : 'Creating your ride…'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.goldBtn} onPress={handleConfirmBooking}>
              <Text style={styles.goldBtnText}>Confirm Booking →</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FULL DAY / SCHEDULED / FAVORITE / STANDARD
  // ══════════════════════════════════════════════════════════════════════════
  if (bookingMode === 'full_day') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <FullDayHireTab onRideCreated={handleRideCreated} />
      </SafeAreaView>
    );
  }
  if (bookingMode === 'scheduled') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <ScheduledRideTab onRideCreated={handleRideCreated} />
      </SafeAreaView>
    );
  }
  if (bookingMode === 'favorite') {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <View style={styles.comingSoon}>
          <View style={styles.comingSoonIcon}>
            <SymbolView name="heart.fill" style={{ width: 36, height: 36 }} tintColor="#D4AF37" resizeMode="scaleAspectFit" />
          </View>
          <Text style={styles.comingSoonTitle}>Favorite Drivers</Text>
          <Text style={styles.comingSoonText}>Book your trusted drivers directly. Coming soon!</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Standard booking ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: '#1A2744' }]}>
      {isSuspended && (
        <View style={styles.suspendedBanner}>
          <Text style={styles.suspendedText}>⚠️ Account suspended — contact Jih support.</Text>
        </View>
      )}

      <ModeBar />

      <View style={styles.inputs}>
        <LocationSearch label="Pickup location" value={pickupText} onChange={setPickupText}
          onSelect={loc => { handleSetPickup(loc); setSettingField('destination'); }}
          onClear={() => { setPickup(null); setPickupText(''); setRouteCoords([]); setPanelOpen(false); setSettingField('pickup'); }}
          onFocus={() => setSettingField('pickup')} showGps onGps={handleGps} />
        <View style={{ height: 8 }} />
        <LocationSearch label="Where to?" value={destText} onChange={setDestText}
          onSelect={handleSetDestination}
          onClear={() => { setDestination(null); setDestText(''); setRouteCoords([]); setPanelOpen(false); setSettingField('destination'); }}
          onFocus={() => setSettingField('destination')} />
        {stops.map((_, i) => (
          <View key={i} style={{ marginTop: 8 }}>
            <LocationSearch label={`Stop ${i + 1}`} value={stopTexts[i] || ''}
              onFocus={() => setSettingField(i)}
              onChange={val => { const t = [...stopTexts]; t[i] = val; setStopTexts(t); }}
              onSelect={loc => {
                const s = [...stops]; s[i] = loc; setStops(s);
                const t = [...stopTexts]; t[i] = loc.address; setStopTexts(t);
                if (pickup && destination) fetchRoute(pickup, destination, s);
              }}
              onClear={() => removeStop(i)} />
          </View>
        ))}
        {destination && stops.length < 3 && (
          <TouchableOpacity onPress={addStop} style={{ marginTop: 8 }}>
            <Text style={{ color: '#D4AF37', fontSize: 12, fontWeight: '600' }}>+ Add Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flex: 1, position: 'relative' }}>
        <BookingMap pickup={pickup} destination={destination}
          stops={stops.filter(s => s.lat !== 0)}
          onMapPress={handleMapPress} routeCoords={routeCoords} />

        {/* ── Map pin mode bar — visible until both points are set ── */}
        {(!pickup || !destination) && (
          <View style={styles.mapModeBar}>
            <TouchableOpacity
              style={[styles.mapModeBtn, settingField === 'pickup' && styles.mapModeBtnActive]}
              onPress={() => setSettingField('pickup')}
            >
              <View style={[styles.mapModeDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[styles.mapModeBtnText, settingField === 'pickup' && styles.mapModeBtnTextActive]}>
                {pickup ? '✓ Pickup set' : 'Tap to set Pickup'}
              </Text>
            </TouchableOpacity>
            <View style={styles.mapModeDivider} />
            <TouchableOpacity
              style={[styles.mapModeBtn, settingField === 'destination' && styles.mapModeBtnActive]}
              onPress={() => setSettingField('destination')}
            >
              <View style={[styles.mapModeDot, { backgroundColor: '#ef4444' }]} />
              <Text style={[styles.mapModeBtnText, settingField === 'destination' && styles.mapModeBtnTextActive]}>
                {destination ? '✓ Destination set' : 'Tap to set Destination'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Crosshair — shows where tap will land, non-interactive ── */}
        {(!pickup || !destination) && (
          <View style={styles.crosshairWrap} pointerEvents="none">
            <View style={styles.crosshairRing}>
              <SymbolView
                name="plus"
                style={{ width: 20, height: 20 }}
                tintColor={settingField === 'pickup' ? '#22c55e' : '#ef4444'}
                resizeMode="scaleAspectFit"
              />
            </View>
          </View>
        )}

        {panelOpen && pickup && destination && (
          <View style={styles.bottomPanel}>
            <View style={styles.panelHandle} />

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => { setRideType('private'); setGroupSize(1); }}
                style={[styles.rideTypeBtn, rideType === 'private' && styles.rideTypeBtnActive]}
              >
                <Text style={[styles.rideTypeBtnText, rideType === 'private' && { color: '#1A2744' }]}>Private Trip</Text>
              </TouchableOpacity>
              <View style={[styles.rideTypeBtn, { opacity: 0.4 }]}>
                <Text style={styles.rideTypeBtnText}>Share Ride</Text>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}> Soon</Text>
              </View>
            </View>

            <VehicleSelector selected={vehicleType} onSelect={setVehicleType}
              distanceKm={distanceKm} durationMin={durationMin}
              isShareRide={isShareRide} groupSize={groupSize} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                🗺️ {distanceKm.toFixed(1)} km · ⏱ {durationMin} min
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                {isShareRide && <Text style={styles.strikeThrough}>{formatUsd(standardFare)}</Text>}
                <Text style={styles.fareGold}>{formatDualCurrency(fare)}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {PAYMENT_OPTIONS.map(pm => {
                const active = paymentMethod === pm.id;
                return (
                  <TouchableOpacity key={pm.id} onPress={() => setPaymentMethod(pm.id)}
                    style={[styles.paymentBtn, active && styles.paymentBtnActive]}>
                    <SymbolView name={pm.symbol} style={{ width: 14, height: 14 }} tintColor={active ? '#D4AF37' : 'rgba(255,255,255,0.7)'} resizeMode="scaleAspectFit" />
                    <Text style={{ color: active ? '#D4AF37' : '#fff', fontSize: 12, fontWeight: active ? '700' : '400' }}>{pm.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.goldBtn} onPress={handleOpenConfirm}>
              <Text style={styles.goldBtnText}>
                Book {selectedVehicle.label} · {formatUsd(fare)} →
              </Text>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{label}</Text>
      <Text style={{ fontSize: 13, color: highlight ? '#D4AF37' : '#fff', fontWeight: highlight ? '700' : '500', maxWidth: '60%', textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1 },

  // mode bar
  modeBar: { flexGrow: 0, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  modeTab: { paddingHorizontal: 14, paddingVertical: 6, marginRight: 6, borderRadius: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modeTabActive: { borderBottomColor: '#D4AF37' },
  modeTabText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
  modeTabTextActive: { color: '#D4AF37' },

  inputs: { padding: 12, zIndex: 20 },
  suspendedBanner: { margin: 12, padding: 10, borderRadius: 10, backgroundColor: 'rgba(212,175,55,0.15)', borderWidth: 1.5, borderColor: '#D4AF37' },
  suspendedText: { color: '#D4AF37', fontSize: 12 },

  // map panel
  bottomPanel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#243059', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, maxHeight: '65%', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  panelHandle: { width: 40, height: 4, backgroundColor: 'rgba(212,175,55,0.4)', borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  rideTypeBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1A2744', alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  rideTypeBtnActive: { backgroundColor: '#D4AF37' },
  rideTypeBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  paymentBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#1A2744', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 },
  paymentBtnActive: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.15)' },
  preRouteCta: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: '#1A2744', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },

  // ── Map pin mode bar ──
  mapModeBar: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', backgroundColor: 'rgba(26,39,68,0.92)', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  mapModeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 12 },
  mapModeBtnActive: { backgroundColor: 'rgba(212,175,55,0.15)' },
  mapModeDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  mapModeBtnText: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.55)', flexShrink: 1 },
  mapModeBtnTextActive: { color: '#fff', fontWeight: '700' },
  mapModeDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 8 },

  // ── Crosshair ──
  crosshairWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  crosshairRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(26,39,68,0.35)', alignItems: 'center', justifyContent: 'center' },

  // confirm
  confirmHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  confirmTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  confirmCard: { backgroundColor: '#243059', borderRadius: 16, padding: 16, marginBottom: 0 },
  confirmFooter: { padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },

  // route
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e' },
  routeLine: { width: 2, flex: 1, minHeight: 24, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  routeLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 },
  routeAddress: { fontSize: 13, color: '#fff', fontWeight: '500', marginTop: 2 },
  detailLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  fareGold: { color: '#D4AF37', fontWeight: '700', fontSize: 16 },
  strikeThrough: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textDecorationLine: 'line-through' },

  // payment in confirm
  pmBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#1A2744', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 5 },
  pmBtnActive: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.15)' },
  pmBtnText: { color: '#fff', fontSize: 12 },

  // loading state
  loadingBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  loadingText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },

  // result (success / error)
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  resultIconBox: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(212,175,55,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  resultEmoji: { fontSize: 36 },
  resultTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 10, textAlign: 'center' },
  resultBody: { fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  summaryCard: { width: '100%', backgroundColor: '#243059', borderRadius: 16, padding: 16, marginBottom: 24, gap: 4 },

  // shared buttons
  goldBtn: { backgroundColor: '#D4AF37', borderRadius: 12, paddingVertical: 17, alignItems: 'center', width: '100%' },
  goldBtnText: { color: '#1A2744', fontWeight: '700', fontSize: 16 },

  // coming soon
  comingSoon: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  comingSoonIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(212,175,55,0.12)', borderWidth: 1.5, borderColor: 'rgba(212,175,55,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  comingSoonTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  comingSoonText: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 14 },
});
