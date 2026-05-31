/**
 * RideMap — native (react-native-maps)
 *
 * Reads driver position from driver_profiles.current_lat / current_lng.
 * Uses THREE mechanisms so something always catches an update:
 *   1. Initial fetch on mount / when driverId changes
 *   2. Supabase realtime subscription (UPDATE on driver_profiles)
 *   3. Polling every 4 seconds as a reliable fallback
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { supabase } from '@/lib/supabase';

const VEHICLE_SYMBOL: Record<string, SFSymbol> = {
  tuktuk: 'car.2.fill',
  car:    'car.fill',
  moto:   'motorcycle',
  van:    'bus.fill',
};

interface Props {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  driverId: string | null;
  rideStatus: string;
  vehicleType?: string;
  onEtaUpdate?: (etaMinutes: number | null) => void;
}

type Pos = { lat: number; lng: number };

export default function RideMap({
  pickupLat, pickupLng, destLat, destLng,
  driverId, rideStatus, vehicleType, onEtaUpdate,
}: Props) {
  const mapRef  = useRef<MapView>(null);
  const [driverPos, setDriverPos]   = useState<Pos | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  // ── Fetch driver location from DB ────────────────────────────────────────
  const fetchDriverLoc = async () => {
    if (!driverId) return;
    const { data } = await supabase
      .from('driver_profiles' as any)
      .select('current_lat, current_lng')
      .eq('user_id', driverId)
      .maybeSingle() as any;
    if (data?.current_lat && data?.current_lng) {
      setDriverPos({ lat: data.current_lat, lng: data.current_lng });
    }
  };

  // Initial fetch + realtime subscription + 4-second polling
  useEffect(() => {
    if (!driverId) return;

    fetchDriverLoc();

    // Realtime
    const channel = supabase
      .channel(`driver-loc-${driverId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'driver_profiles', filter: `user_id=eq.${driverId}`,
      }, (payload: any) => {
        const { current_lat, current_lng } = payload.new ?? {};
        if (current_lat && current_lng) setDriverPos({ lat: current_lat, lng: current_lng });
      })
      .subscribe();

    // Polling fallback
    const poll = setInterval(fetchDriverLoc, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [driverId]);

  // ── Recalculate route whenever driver position or ride status changes ─────
  useEffect(() => {
    if (!driverPos) { onEtaUpdate?.(null); return; }

    const tLat = rideStatus === 'in_progress' ? destLat   : pickupLat;
    const tLng = rideStatus === 'in_progress' ? destLng   : pickupLng;

    fetch(
      `https://router.project-osrm.org/route/v1/driving/` +
      `${driverPos.lng},${driverPos.lat};${tLng},${tLat}` +
      `?overview=full&geometries=geojson`
    )
      .then(r => r.json())
      .then(data => {
        if (data.routes?.[0]) {
          const geom = data.routes[0].geometry.coordinates as [number, number][];
          setRouteCoords(geom.map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
          onEtaUpdate?.(Math.max(1, Math.round(data.routes[0].duration / 60)));
        }
      })
      .catch(() => onEtaUpdate?.(null));
  }, [driverPos?.lat, driverPos?.lng, rideStatus, pickupLat, pickupLng, destLat, destLng]);

  // ── Fit all markers into view ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const pts = [
      { latitude: pickupLat, longitude: pickupLng },
      { latitude: destLat,   longitude: destLng   },
    ];
    if (driverPos) pts.push({ latitude: driverPos.lat, longitude: driverPos.lng });
    mapRef.current.fitToCoordinates(pts, {
      edgePadding: { top: 60, right: 40, bottom: 80, left: 40 },
      animated: true,
    });
  }, [driverPos, pickupLat, pickupLng, destLat, destLng]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickupLat, longitude: pickupLng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        <Marker coordinate={{ latitude: pickupLat, longitude: pickupLng }} title="Pickup"      pinColor="#22c55e" />
        <Marker coordinate={{ latitude: destLat,   longitude: destLng   }} title="Destination" pinColor="#ef4444" />

        {driverPos && (
          <Marker
            coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }}
            title="Your Driver"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.driverMarker}>
              <SymbolView
                name={VEHICLE_SYMBOL[vehicleType ?? ''] ?? 'car.fill'}
                style={styles.driverMarkerIcon}
                tintColor="#fff"
                resizeMode="scaleAspectFit"
              />
            </View>
          </Marker>
        )}

        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor="#D4AF37" strokeWidth={4} />
        )}
      </MapView>

      {/* Show "waiting for driver location" when driver exists but has no GPS yet */}
      {!driverPos && driverId && (
        <View style={styles.noLocBanner}>
          <Text style={styles.noLocText}>📡 Waiting for driver location…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  noLocBanner: {
    position: 'absolute',
    top: 12, left: 12, right: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  noLocText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  driverMarker: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D4AF37' },
  driverMarkerIcon: { width: 20, height: 20 },
});
