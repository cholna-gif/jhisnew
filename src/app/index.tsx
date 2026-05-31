import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { hasActiveRide } from '@/lib/ride-guards';
import { VEHICLE_OPTIONS, calculateFare, calculateShareFare } from '@/components/booking/VehicleSelector';
import VehicleSelector from '@/components/booking/VehicleSelector';
import LocationSearch from '@/components/booking/LocationSearch';
import BookingMap from '@/components/booking/BookingMap';
import PaymentSelection from '@/components/booking/PaymentSelection';
import FullDayHireTab from '@/components/booking/FullDayHireTab';
import ScheduledRideTab from '@/components/booking/ScheduledRideTab';
import { formatDualCurrency, formatUsd } from '@/lib/currency';
import { haversineDistance } from '@/lib/geo-utils';
import { LatLng, BookingMode, RideType } from '@/types';

const MODES: { id: BookingMode; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'full_day', label: 'Full Day' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'favorite', label: 'Favorite' },
];

const PAYMENT_OPTIONS = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'card', label: '💳 Card' },
  { id: 'wallet', label: '👛 Wallet' },
];

export default function BookScreen() {
  const { user, profile } = useAuth();
  const isSuspended = !!profile?.is_suspended;

  const [bookingMode, setBookingMode] = useState<BookingMode>('standard');
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [stops, setStops] = useState<LatLng[]>([]);
  const [pickupText, setPickupText] = useState('');
  const [destText, setDestText] = useState('');
  const [stopTexts, setStopTexts] = useState<string[]>([]);
  const [vehicleType, setVehicleType] = useState('tuktuk');
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMin, setDurationMin] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingField, setSettingField] = useState<'pickup' | 'destination' | number>('pickup');
  const [rideType, setRideType] = useState<RideType>('private');
  const [groupSize, setGroupSize] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedVehicle = VEHICLE_OPTIONS.find(v => v.type === vehicleType)!;
  const isShareRide = rideType === 'share';
  const fare = isShareRide
    ? calculateShareFare(selectedVehicle, distanceKm)
    : calculateFare(selectedVehicle, distanceKm);
  const standardFare = calculateFare(selectedVehicle, distanceKm);

  // Validate vehicle when group size changes
  useEffect(() => {
    if (selectedVehicle && selectedVehicle.maxSeats < groupSize) {
      const firstValid = VEHICLE_OPTIONS.find(v => v.maxSeats >= groupSize);
      if (firstValid) setVehicleType(firstValid.type);
    }
  }, [groupSize]);

  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      );
      const data = await res.json();
      return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  };

  const fetchRoute = useCallback(async (p: LatLng, d: LatLng, s: LatLng[]) => {
    const waypoints = [p, ...s.filter(w => w.lat !== 0), d];
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes?.[0]) {
        const geom = data.routes[0].geometry.coordinates as [number, number][];
        setRouteCoords(geom.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
        setDistanceKm(data.routes[0].distance / 1000);
        setDurationMin(Math.round(data.routes[0].duration / 60));
        setPanelOpen(true);
      }
    } catch {
      let totalDist = haversineDistance(p, d);
      const points = [p, ...s.filter(w => w.lat !== 0), d];
      if (points.length > 2) {
        totalDist = 0;
        for (let i = 0; i < points.length - 1; i++) {
          totalDist += haversineDistance(points[i], points[i + 1]);
        }
      }
      const roadDist = totalDist * 1.3;
      setDistanceKm(roadDist);
      setDurationMin(Math.round((roadDist / 30) * 60));
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

  const handleMapPress = useCallback(async (latlng: { lat: number; lng: number }) => {
    const address = await reverseGeocode(latlng.lat, latlng.lng);
    const loc = { ...latlng, address };
    if (settingField === 'pickup') { handleSetPickup(loc); setSettingField('destination'); }
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
    const loc = await Location.getCurrentPositionAsync({});
    const address = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
    handleSetPickup({ lat: loc.coords.latitude, lng: loc.coords.longitude, address });
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

  const handleFindDriver = () => {
    if (isSuspended) {
      Alert.alert('Account Suspended', 'Your account has been suspended. Please contact Jih support.');
      return;
    }
    if (!pickup || !destination || !vehicleType) {
      Alert.alert('Error', 'Please set pickup, destination, and vehicle type');
      return;
    }
    setShowConfirm(true);
  };

  const handlePaymentConfirmed = async (method: string, paymentStatus: string) => {
    if (!pickup || !destination || !user) return;
    if (isSuspended) {
      Alert.alert('Account Suspended', 'Your account has been suspended.');
      return;
    }
    setLoading(true);

    if (await hasActiveRide(user.id)) {
      Alert.alert('Active Ride', 'You already have an active ride. Please complete or cancel it first.');
      setLoading(false);
      return;
    }

    const remainingSeats = isShareRide ? selectedVehicle.maxSeats - groupSize : 0;

    const { error } = await supabase.from('rides' as any).insert({
      passenger_id: user.id,
      booking_type: 'standard',
      status: 'pending',
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      destination_address: destination.address,
      destination_lat: destination.lat,
      destination_lng: destination.lng,
      stops: stops.filter(s => s.lat !== 0).map(s => ({ lat: s.lat, lng: s.lng, address: s.address })),
      vehicle_type: vehicleType,
      estimated_fare: parseFloat(fare.toFixed(2)),
      distance_km: parseFloat(distanceKm.toFixed(2)),
      duration_minutes: durationMin,
      payment_method: method,
      payment_status: paymentStatus,
      ride_type: rideType,
      group_size: groupSize,
      remaining_seats: remainingSeats > 0 ? remainingSeats : null,
      shared_ride_group: isShareRide ? generateUUID() : null,
    } as any);

    setLoading(false);
    setShowPayment(false);
    setShowConfirm(false);
    if (error) {
      Alert.alert('Error', 'Failed to create ride. Please try again.');
    } else {
      Alert.alert('Success', 'Ride requested! Looking for a driver...');
      // Reset form
      setPickup(null); setDestination(null); setStops([]);
      setPickupText(''); setDestText(''); setStopTexts([]);
      setRouteCoords([]); setPanelOpen(false);
    }
  };

  const handleRideCreated = () => {
    setBookingMode('standard');
    setPanelOpen(false);
  };

  // Mode sub-tabs
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

  // Payment screen
  if (showPayment) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <PaymentSelection
          fare={fare}
          onConfirm={handlePaymentConfirmed}
          onBack={() => setShowPayment(false)}
        />
      </SafeAreaView>
    );
  }

  // Confirm booking screen
  if (showConfirm) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#1A2744' }]}>
        <View style={styles.confirmHeader}>
          <TouchableOpacity onPress={() => setShowConfirm(false)}>
            <Text style={styles.backBtn}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.confirmTitle}>Confirm Booking</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {/* Route card */}
          <View style={styles.confirmCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeDots}>
                <View style={styles.dotGreen} />
                <View style={styles.routeLine} />
                <View style={styles.dotRed} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>Pickup</Text>
                <Text style={styles.routeAddress}>{pickupText || 'Pinned location'}</Text>
                <View style={{ height: 12 }} />
                <Text style={styles.routeLabel}>Destination</Text>
                <Text style={styles.routeAddress}>{destText || 'Pinned location'}</Text>
              </View>
            </View>
          </View>

          {/* Details card */}
          <View style={styles.confirmCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Vehicle</Text>
              <Text style={styles.detailValue}>{selectedVehicle.label}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Ride type</Text>
              <Text style={styles.detailValue}>
                {rideType === 'share' ? `Share · ${groupSize} passenger${groupSize > 1 ? 's' : ''}` : 'Private'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Distance</Text>
              <Text style={styles.detailValue}>{distanceKm.toFixed(1)} km · {durationMin} min</Text>
            </View>
            <View style={[styles.detailRow, styles.detailRowBorderTop]}>
              <Text style={styles.detailLabel}>Estimated fare</Text>
              <View style={{ alignItems: 'flex-end' }}>
                {isShareRide && <Text style={styles.strikeThrough}>{formatUsd(standardFare)}</Text>}
                <Text style={styles.fareGold}>{formatDualCurrency(fare)}</Text>
              </View>
            </View>
          </View>

          {/* Payment */}
          <View style={styles.confirmCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Payment</Text>
              <Text style={styles.detailValue}>
                {{ cash: '💵 Cash', card: '💳 Card', wallet: '👛 Wallet' }[paymentMethod] ?? paymentMethod}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.confirmFooter}>
          <TouchableOpacity
            style={[styles.confirmBtn, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={() => handlePaymentConfirmed(paymentMethod, paymentMethod === 'cash' ? 'pending' : 'paid')}
          >
            {loading
              ? <ActivityIndicator color="#1A2744" />
              : <Text style={styles.confirmBtnText}>Confirm Booking →</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (bookingMode === 'full_day') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <FullDayHireTab onRideCreated={handleRideCreated} />
      </SafeAreaView>
    );
  }

  if (bookingMode === 'scheduled') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <ScheduledRideTab onRideCreated={handleRideCreated} />
      </SafeAreaView>
    );
  }

  if (bookingMode === 'favorite') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#1A2744' }]}>
        <ModeBar />
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonIcon}>❤️</Text>
          <Text style={styles.comingSoonTitle}>Favorite Drivers</Text>
          <Text style={styles.comingSoonText}>Book your trusted drivers directly. Coming soon!</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Standard booking
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#1A2744' }]}>
      {isSuspended && (
        <View style={styles.suspendedBanner}>
          <Text style={styles.suspendedText}>⚠️ Your account has been suspended. Contact Jih support.</Text>
        </View>
      )}

      <ModeBar />

      {/* Location inputs */}
      <View style={styles.inputs}>
        <LocationSearch
          label="Pickup location"
          value={pickupText}
          onChange={setPickupText}
          onSelect={loc => { handleSetPickup(loc); setSettingField('destination'); }}
          onClear={() => { setPickup(null); setPickupText(''); setRouteCoords([]); setPanelOpen(false); setSettingField('pickup'); }}
          onFocus={() => setSettingField('pickup')}
          showGps
          onGps={handleGps}
        />
        <View style={{ height: 8 }} />
        <LocationSearch
          label="Where to?"
          value={destText}
          onChange={setDestText}
          onSelect={handleSetDestination}
          onClear={() => { setDestination(null); setDestText(''); setRouteCoords([]); setPanelOpen(false); setSettingField('destination'); }}
          onFocus={() => setSettingField('destination')}
        />
        {stops.map((_, i) => (
          <View key={i} style={{ marginTop: 8 }}>
            <LocationSearch
              label={`Stop ${i + 1}`}
              value={stopTexts[i] || ''}
              onFocus={() => setSettingField(i)}
              onChange={val => { const t = [...stopTexts]; t[i] = val; setStopTexts(t); }}
              onSelect={loc => {
                const s = [...stops]; s[i] = loc; setStops(s);
                const t = [...stopTexts]; t[i] = loc.address; setStopTexts(t);
                if (pickup && destination) fetchRoute(pickup, destination, s);
              }}
              onClear={() => removeStop(i)}
            />
          </View>
        ))}
        {destination && stops.length < 3 && (
          <TouchableOpacity onPress={addStop} style={styles.addStop}>
            <Text style={styles.addStopText}>+ Add Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Map */}
      <View style={{ flex: 1, position: 'relative' }}>
        <BookingMap
          pickup={pickup}
          destination={destination}
          stops={stops.filter(s => s.lat !== 0)}
          onMapPress={handleMapPress}
          routeCoords={routeCoords}
        />

        {/* Bottom booking panel */}
        {panelOpen && pickup && destination && (
          <View style={styles.bottomPanel}>
            <View style={styles.panelHandle} />

            {/* Private / Share toggle */}
            <View style={styles.rideTypeRow}>
              <TouchableOpacity
                onPress={() => { setRideType('private'); setGroupSize(1); }}
                style={[styles.rideTypeBtn, rideType === 'private' && styles.rideTypeBtnActive]}
              >
                <Text style={[styles.rideTypeBtnText, rideType === 'private' && styles.rideTypeBtnTextActive]}>
                  Private Trip
                </Text>
              </TouchableOpacity>
              <View style={[styles.rideTypeBtn, styles.rideTypeBtnDisabled]}>
                <Text style={styles.rideTypeBtnDisabledText}>Share Ride</Text>
                <Text style={styles.comingSoonBadge}> Soon</Text>
              </View>
            </View>

            <VehicleSelector
              selected={vehicleType}
              onSelect={setVehicleType}
              distanceKm={distanceKm}
              durationMin={durationMin}
              isShareRide={isShareRide}
              groupSize={groupSize}
            />

            <View style={styles.fareRow}>
              <Text style={styles.fareInfo}>🗺️ {distanceKm.toFixed(1)} km · ⏱ {durationMin} min</Text>
              <View style={{ alignItems: 'flex-end' }}>
                {isShareRide && <Text style={styles.strikeThrough}>{formatUsd(standardFare)}</Text>}
                <Text style={styles.fareGold}>{formatDualCurrency(fare)}</Text>
              </View>
            </View>

            {/* Payment method */}
            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map(pm => (
                <TouchableOpacity
                  key={pm.id}
                  onPress={() => setPaymentMethod(pm.id)}
                  style={[styles.paymentBtn, paymentMethod === pm.id && styles.paymentBtnActive]}
                >
                  <Text style={styles.paymentBtnText}>{pm.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.bookBtn, (!pickup || !destination || loading) && styles.btnDisabled]}
              disabled={!pickup || !destination || loading}
              onPress={handleFindDriver}
            >
              <Text style={styles.bookBtnText}>
                Book {selectedVehicle.label} · {formatUsd(fare)} →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pre-route placeholder */}
        {(!panelOpen || !pickup || !destination) && (
          <View style={styles.preRouteCta}>
            <View style={styles.preRouteBtn}>
              <Text style={styles.preRouteBtnText}>Set pickup &amp; destination →</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeBar: { flexGrow: 0, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  modeTab: { paddingHorizontal: 14, paddingVertical: 6, marginRight: 6, borderRadius: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modeTabActive: { borderBottomColor: '#D4AF37' },
  modeTabText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
  modeTabTextActive: { color: '#D4AF37' },
  inputs: { padding: 12, zIndex: 20 },
  addStop: { marginTop: 8 },
  addStopText: { color: '#D4AF37', fontSize: 12, fontWeight: '600' },
  suspendedBanner: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    borderRadius: 10,
    margin: 12,
    padding: 10,
  },
  suspendedText: { color: '#D4AF37', fontSize: 12 },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#243059',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 12,
    maxHeight: '65%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  panelHandle: { width: 40, height: 4, backgroundColor: 'rgba(212,175,55,0.4)', borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  rideTypeRow: { flexDirection: 'row', gap: 8 },
  rideTypeBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#1A2744', alignItems: 'center' },
  rideTypeBtnActive: { backgroundColor: '#D4AF37' },
  rideTypeBtnDisabled: { backgroundColor: '#1A2744', opacity: 0.5, flexDirection: 'row', justifyContent: 'center' },
  rideTypeBtnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  rideTypeBtnTextActive: { color: '#1A2744' },
  rideTypeBtnDisabledText: { color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: '600' },
  comingSoonBadge: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareInfo: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  fareGold: { color: '#D4AF37', fontWeight: '700', fontSize: 16 },
  strikeThrough: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textDecorationLine: 'line-through' },
  paymentRow: { flexDirection: 'row', gap: 8 },
  paymentBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#1A2744', alignItems: 'center' },
  paymentBtnActive: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.15)' },
  paymentBtnText: { color: '#fff', fontSize: 12 },
  bookBtn: { backgroundColor: '#D4AF37', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  bookBtnText: { color: '#1A2744', fontSize: 15, fontWeight: '700' },
  preRouteCta: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, backgroundColor: '#1A2744', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  preRouteBtn: { backgroundColor: 'rgba(212,175,55,0.3)', borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  preRouteBtnText: { color: '#1A2744', fontWeight: '700', fontSize: 15 },
  comingSoon: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  comingSoonIcon: { fontSize: 52, marginBottom: 12 },
  comingSoonTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  comingSoonText: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 14 },
  // Confirm screens
  confirmHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  backBtn: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  confirmTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  confirmCard: { backgroundColor: '#243059', borderRadius: 16, padding: 16 },
  routeRow: { flexDirection: 'row', gap: 12 },
  routeDots: { alignItems: 'center', paddingTop: 4 },
  dotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22c55e' },
  routeLine: { width: 2, flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  dotRed: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  routeLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 },
  routeAddress: { fontSize: 13, color: '#fff', fontWeight: '500', marginTop: 2 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  detailRowBorderTop: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', marginTop: 8, paddingTop: 12 },
  detailLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  detailValue: { fontSize: 13, color: '#fff', fontWeight: '500' },
  confirmFooter: { padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', gap: 8 },
  confirmBtn: { backgroundColor: '#D4AF37', borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  confirmBtnText: { color: '#1A2744', fontSize: 16, fontWeight: '700' },
});
