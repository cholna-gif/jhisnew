import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { hasActiveRide, isPassengerSuspended, SUSPENDED_BOOKING_MSG } from '@/lib/ride-guards';
import BookingMap from './BookingMap';
import LocationSearch from './LocationSearch';
import { LatLng } from '@/types';

const VEHICLES = [
  { type: 'tuktuk', label: 'Tuk Tuk', icon: '🛺' },
  { type: 'car', label: 'Car', icon: '🚗' },
  { type: 'van', label: 'Van', icon: '🚐' },
];

const PAYMENT_OPTIONS = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'card', label: 'Card', icon: '💳' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
];

interface FullDayHireTabProps {
  onRideCreated: () => void;
}

export default function FullDayHireTab({ onRideCreated }: FullDayHireTabProps) {
  const { user } = useAuth();
  const [pickupText, setPickupText] = useState('');
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [vehicleType, setVehicleType] = useState('tuktuk');
  const [description, setDescription] = useState('');
  const [offeredFare, setOfferedFare] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [loading, setLoading] = useState(false);

  const handleGps = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission denied', 'Location permission is required.'); return; }
    const loc = await Location.getCurrentPositionAsync({});
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.coords.latitude}&lon=${loc.coords.longitude}`
      );
      const data = await res.json();
      const address = data.display_name || `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`;
      const l: LatLng = { lat: loc.coords.latitude, lng: loc.coords.longitude, address };
      setPickup(l);
      setPickupText(address);
    } catch {
      const address = `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`;
      setPickup({ lat: loc.coords.latitude, lng: loc.coords.longitude, address });
      setPickupText(address);
    }
  }, []);

  const handleMapPress = useCallback(async (latlng: { lat: number; lng: number }) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`
      );
      const data = await res.json();
      const address = data.display_name || `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
      setPickup({ lat: latlng.lat, lng: latlng.lng, address });
      setPickupText(address);
    } catch {
      const address = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
      setPickup({ lat: latlng.lat, lng: latlng.lng, address });
      setPickupText(address);
    }
  }, []);

  const handleSubmit = async () => {
    if (!user || !pickup || !description.trim() || !offeredFare) return;
    const fare = parseFloat(offeredFare);
    if (isNaN(fare) || fare <= 0) { Alert.alert('Error', 'Please enter a valid price'); return; }

    setLoading(true);

    if (await isPassengerSuspended(user.id)) {
      Alert.alert('Account Suspended', SUSPENDED_BOOKING_MSG);
      setLoading(false);
      return;
    }

    if (await hasActiveRide(user.id)) {
      Alert.alert('Active Ride', 'You already have an active ride. Please complete or cancel it first.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('rides' as any).insert({
      passenger_id: user.id,
      booking_type: 'full_day',
      status: 'pending',
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      vehicle_type: vehicleType,
      offered_fare: fare,
      hire_description: description.trim(),
      payment_method: paymentMethod,
      ride_type: 'private',
      group_size: 1,
    } as any);

    setLoading(false);
    if (error) {
      console.error('Full day insert error:', error);
      Alert.alert('Booking Failed', error.message || 'Failed to send offer. Please try again.');
    } else {
      Alert.alert('Offer Sent! 🛺', 'Looking for a driver to accept…');
      onRideCreated();
    }
  };

  const formComplete = !!(pickup && description.trim() && offeredFare && parseFloat(offeredFare) > 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <SymbolView name="calendar.badge.clock" style={{ width: 22, height: 22 }} tintColor="#fff" resizeMode="scaleAspectFit" />
          <Text style={styles.title}>Full Day Hire</Text>
        </View>
        <Text style={styles.subtitle}>Tap map or search to set pickup</Text>

        <Text style={styles.fieldLabel}>PICKUP LOCATION</Text>
        <LocationSearch
          label="Where should driver pick you up?"
          value={pickupText}
          onChange={setPickupText}
          onSelect={loc => { setPickup(loc); setPickupText(loc.address); }}
          onClear={() => { setPickup(null); setPickupText(''); }}
          showGps
          onGps={handleGps}
        />

        <View style={styles.mapContainer}>
          <BookingMap
            pickup={pickup}
            destination={null}
            stops={[]}
            onMapPress={handleMapPress}
          />
        </View>

        <Text style={styles.fieldLabel}>WHAT DO YOU WANT TO DO?</Text>
        <TextInput
          style={styles.textarea}
          placeholder="e.g. Tour Angkor Wat temples, visit Tonle Sap lake..."
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          maxLength={500}
        />

        <Text style={styles.fieldLabel}>YOUR OFFERED PRICE (USD)</Text>
        <TextInput
          style={styles.input}
          placeholder="50.00"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={offeredFare}
          onChangeText={setOfferedFare}
          keyboardType="decimal-pad"
        />

        {formComplete && (
          <>
            <Text style={styles.fieldLabel}>VEHICLE TYPE</Text>
            <View style={styles.vehicleRow}>
              {VEHICLES.map(v => (
                <TouchableOpacity
                  key={v.type}
                  onPress={() => setVehicleType(v.type)}
                  style={[styles.vehicleBtn, vehicleType === v.type && styles.vehicleBtnSelected]}
                >
                  <Text style={styles.vehicleIcon}>{v.icon}</Text>
                  <Text style={[styles.vehicleLabel, vehicleType === v.type && styles.vehicleLabelSelected]}>
                    {v.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>PAYMENT METHOD</Text>
            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPaymentMethod(p.id)}
                  style={[styles.paymentBtn, paymentMethod === p.id && styles.paymentBtnSelected]}
                >
                  <Text style={styles.vehicleIcon}>{p.icon}</Text>
                  <Text style={[styles.vehicleLabel, paymentMethod === p.id && styles.vehicleLabelSelected]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitBtn, (!formComplete || loading) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!formComplete || loading}
        >
          {loading ? (
            <ActivityIndicator color="#1A2744" />
          ) : (
            <Text style={styles.submitBtnText}>Send Full Day Request →</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#1A2744' },
  content: { padding: 16, paddingBottom: 120 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 16 },
  fieldLabel: { fontSize: 11, color: '#D4AF37', fontWeight: '600', letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#243059',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  textarea: {
    backgroundColor: '#243059',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  mapContainer: { height: 240, borderRadius: 12, overflow: 'hidden', marginVertical: 12 },
  vehicleRow: { flexDirection: 'row', gap: 8 },
  vehicleBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#243059',
    alignItems: 'center',
  },
  vehicleBtnSelected: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.1)' },
  vehicleIcon: { fontSize: 22, marginBottom: 4 },
  vehicleLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  vehicleLabelSelected: { color: '#fff', fontWeight: '600' },
  paymentRow: { flexDirection: 'row', gap: 8 },
  paymentBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#243059',
    alignItems: 'center',
  },
  paymentBtnSelected: { borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.1)' },
  footer: {
    padding: 16,
    backgroundColor: '#1A2744',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  submitBtn: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#1A2744', fontSize: 16, fontWeight: '700' },
});
