import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as Location from 'expo-location';
import { useAuth } from '@/contexts/AuthContext';
import { RidesAPI } from '@/lib/api';
import { hasActiveRide, isPassengerSuspended, SUSPENDED_BOOKING_MSG } from '@/lib/ride-guards';
import { VEHICLE_OPTIONS, calculateFare } from './VehicleSelector';
import VehicleSelector from './VehicleSelector';
import LocationSearch from './LocationSearch';
import BookingMap from './BookingMap';
import { LatLng } from '@/types';
import { haversineDistance } from '@/lib/geo-utils';

const PAYMENT_OPTIONS = [
  { id: 'cash', label: '💵 Cash' },
  { id: 'card', label: '💳 Card' },
  { id: 'wallet', label: '👛 Wallet' },
];

interface ScheduledRideTabProps {
  onRideCreated: () => void;
}

export default function ScheduledRideTab({ onRideCreated }: ScheduledRideTabProps) {
  const { user } = useAuth();
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [stops, setStops] = useState<LatLng[]>([]);
  const [pickupText, setPickupText] = useState('');
  const [destText, setDestText] = useState('');
  const [stopTexts, setStopTexts] = useState<string[]>([]);
  const [vehicleType, setVehicleType] = useState('tuktuk');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMin, setDurationMin] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [settingField, setSettingField] = useState<'pickup' | 'destination' | number>('pickup');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');

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

  const getScheduledDatetime = (): Date | null => {
    if (!selectedDate || !selectedTime) return null;
    const dt = new Date(`${selectedDate}T${selectedTime}:00`);
    return isNaN(dt.getTime()) ? null : dt;
  };

  const handleScheduleRide = async () => {
    if (!pickup || !destination || !user) return;
    const scheduledDt = getScheduledDatetime();
    if (!scheduledDt) { Alert.alert('Error', 'Please enter a valid date and time (YYYY-MM-DD, HH:MM)'); return; }
    const minTime = new Date(Date.now() + 30 * 60 * 1000);
    if (scheduledDt < minTime) {
      Alert.alert('Invalid Time', 'Scheduled time must be at least 30 minutes from now');
      return;
    }
    setLoading(true);
    if (await isPassengerSuspended(user.id)) {
      Alert.alert('Account Suspended', SUSPENDED_BOOKING_MSG);
      setLoading(false); return;
    }
    if (await hasActiveRide(user.id)) {
      Alert.alert('Active Ride', 'You already have an active ride. Please complete or cancel it first.');
      setLoading(false); return;
    }
    const vehicle = VEHICLE_OPTIONS.find(v => v.type === vehicleType)!;
    const fare = calculateFare(vehicle, distanceKm);
    try {
      await RidesAPI.book({
        booking_type: 'scheduled',
        status: 'scheduled',
        scheduled_datetime: scheduledDt.toISOString(),
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
        payment_method: paymentMethod,
        ride_type: 'private',
        group_size: 1,
      } as any);
      setConfirmed(true);
    } catch (e: any) {
      Alert.alert('Booking Failed', e?.message || 'Failed to schedule ride. Please try again.');
    }
    setLoading(false);
  };

  const selectedVehicle = VEHICLE_OPTIONS.find(v => v.type === vehicleType)!;
  const fare = calculateFare(selectedVehicle, distanceKm);
  const scheduledDt = getScheduledDatetime();
  const isValidTime = scheduledDt ? scheduledDt >= new Date(Date.now() + 30 * 60 * 1000) : false;
  const canBook = pickup && destination && vehicleType && selectedDate && selectedTime && isValidTime;

  if (confirmed) {
    return (
      <View style={styles.confirmedContainer}>
        <Text style={styles.confirmedIcon}>✅</Text>
        <Text style={styles.confirmedTitle}>Ride Scheduled!</Text>
        <Text style={styles.confirmedTime}>
          {scheduledDt?.toLocaleString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          })}
        </Text>
        <View style={styles.confirmedCard}>
          <Text style={styles.confirmedDetail}>📍 {pickupText}</Text>
          <Text style={styles.confirmedDetail}>📍 {destText}</Text>
          <View style={styles.confirmedFareRow}>
            <Text style={styles.confirmedFareLabel}>{vehicleType}</Text>
            <Text style={styles.confirmedFareValue}>${fare.toFixed(2)}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={onRideCreated}>
          <Text style={styles.historyBtnText}>View in History</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#1A2744' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Date/time inputs */}
        <View style={styles.dateTimeRow}>
          <View style={{ flex: 3 }}>
            <Text style={styles.fieldLabel}>DATE (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. 2026-06-15"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={selectedDate}
              onChangeText={setSelectedDate}
            />
          </View>
          <View style={{ flex: 2 }}>
            <Text style={styles.fieldLabel}>TIME (HH:MM)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. 09:30"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={selectedTime}
              onChangeText={setSelectedTime}
            />
          </View>
        </View>

        {scheduledDt && (
          <Text style={[styles.validationText, !isValidTime && styles.validationError]}>
            {isValidTime ? `Scheduled: ${scheduledDt.toLocaleString()}` : 'Must be at least 30 min from now'}
          </Text>
        )}

        <View style={styles.searchSection}>
          <LocationSearch
            label="Pickup location"
            value={pickupText}
            onChange={setPickupText}
            onSelect={loc => { handleSetPickup(loc); setSettingField('destination'); }}
            onClear={() => { setPickup(null); setPickupText(''); setPanelOpen(false); setSettingField('pickup'); }}
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
            onClear={() => { setDestination(null); setDestText(''); setPanelOpen(false); setSettingField('destination'); }}
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
            <TouchableOpacity onPress={addStop} style={styles.addStopBtn}>
              <Text style={styles.addStopText}>+ Add Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.mapContainer}>
          <BookingMap
            pickup={pickup}
            destination={destination}
            stops={stops.filter(s => s.lat !== 0)}
            onMapPress={handleMapPress}
            routeCoords={routeCoords}
          />
        </View>

        {panelOpen && pickup && destination && (
          <View style={styles.panel}>
            <VehicleSelector
              selected={vehicleType}
              onSelect={setVehicleType}
              distanceKm={distanceKm}
              durationMin={durationMin}
            />
            <View style={styles.rideInfo}>
              <Text style={styles.rideInfoText}>🗺️ {distanceKm.toFixed(1)} km · ⏱ {durationMin} min</Text>
              <Text style={styles.fareText}>${fare.toFixed(2)}</Text>
            </View>
            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map(pm => (
                <TouchableOpacity
                  key={pm.id}
                  onPress={() => setPaymentMethod(pm.id)}
                  style={[styles.paymentBtn, paymentMethod === pm.id && styles.paymentBtnSelected]}
                >
                  <Text style={styles.paymentBtnText}>{pm.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.scheduleBtn, (!canBook || loading) && styles.scheduleBtnDisabled]}
              onPress={handleScheduleRide}
              disabled={!canBook || loading}
            >
              {loading
                ? <ActivityIndicator color="#1A2744" />
                : <Text style={styles.scheduleBtnText}>📅 Schedule Ride</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#1A2744' },
  confirmedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#1A2744' },
  confirmedIcon: { fontSize: 56, marginBottom: 16 },
  confirmedTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  confirmedTime: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 },
  confirmedCard: { width: '100%', maxWidth: 380, backgroundColor: '#243059', borderRadius: 16, padding: 16, gap: 8, marginBottom: 24 },
  confirmedDetail: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  confirmedFareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  confirmedFareLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  confirmedFareValue: { color: '#D4AF37', fontWeight: '700', fontSize: 14 },
  historyBtn: { backgroundColor: '#D4AF37', borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  historyBtnText: { color: '#1A2744', fontWeight: '700', fontSize: 15 },
  dateTimeRow: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0 },
  fieldLabel: { fontSize: 10, color: '#D4AF37', fontWeight: '600', letterSpacing: 1, marginBottom: 4 },
  textInput: { backgroundColor: '#243059', borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', padding: 10, color: '#fff', fontSize: 13 },
  validationText: { color: '#D4AF37', fontSize: 12, textAlign: 'center', marginVertical: 4, paddingHorizontal: 12 },
  validationError: { color: '#ef4444' },
  searchSection: { padding: 12 },
  addStopBtn: { marginTop: 8 },
  addStopText: { color: '#D4AF37', fontSize: 12, fontWeight: '600' },
  mapContainer: { height: 260, marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  panel: { margin: 12, backgroundColor: '#243059', borderRadius: 16, padding: 16, gap: 12 },
  rideInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rideInfoText: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  fareText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  paymentRow: { flexDirection: 'row', gap: 8 },
  paymentBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', backgroundColor: '#1A2744', alignItems: 'center' },
  paymentBtnSelected: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.15)' },
  paymentBtnText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  scheduleBtn: { backgroundColor: '#D4AF37', borderRadius: 12, padding: 16, alignItems: 'center' },
  scheduleBtnDisabled: { opacity: 0.4 },
  scheduleBtnText: { color: '#1A2744', fontSize: 15, fontWeight: '700' },
});
