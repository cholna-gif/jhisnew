/**
 * BookingMap (native) — shows pickup, destination, route AND nearby online drivers.
 * Online driver positions are fetched every 5 seconds and via Supabase realtime.
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, MapPressEvent, Region } from 'react-native-maps';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { supabase } from '@/lib/supabase';
import { DriversAPI } from '@/lib/api';
import { LatLng } from '@/types';

interface BookingMapProps {
  pickup: LatLng | null;
  destination: LatLng | null;
  stops?: LatLng[];
  onMapPress?: (latlng: { lat: number; lng: number }) => void;
  routeCoords?: { latitude: number; longitude: number }[];
}

interface OnlineDriver {
  user_id: string;
  current_lat: number;
  current_lng: number;
  vehicle_type?: string;
}

const VEHICLE_SYMBOL: Record<string, SFSymbol> = {
  tuktuk: 'car.2.fill',
  car:    'car.fill',
  moto:   'motorcycle',
  van:    'bus.fill',
};

const DEFAULT_REGION: Region = {
  latitude: 13.3671,   // Siem Reap default
  longitude: 103.8498,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function BookingMap({
  pickup, destination, stops = [], onMapPress, routeCoords,
}: BookingMapProps) {
  const mapRef = useRef<MapView>(null);
  const [onlineDrivers, setOnlineDrivers] = useState<OnlineDriver[]>([]);

  // ── Fetch online drivers via backend API ─────────────────────────────────
  const fetchOnlineDrivers = async () => {
    try {
      const data = await DriversAPI.getOnline();
      setOnlineDrivers(data);
    } catch {}
  };

  useEffect(() => {
    fetchOnlineDrivers();

    // Realtime — fires whenever any driver updates their location
    const channel = supabase
      .channel('all-drivers-live')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'driver_profiles',
      }, () => fetchOnlineDrivers())
      .subscribe();

    // Polling fallback every 5 s
    const poll = setInterval(fetchOnlineDrivers, 5000);

    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, []);

  // ── Fit map to visible points ─────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const pts: { latitude: number; longitude: number }[] = [];
    if (pickup)      pts.push({ latitude: pickup.lat,      longitude: pickup.lng });
    if (destination) pts.push({ latitude: destination.lat, longitude: destination.lng });
    stops.forEach(s => pts.push({ latitude: s.lat, longitude: s.lng }));
    if (pts.length >= 2) {
      mapRef.current.fitToCoordinates(pts, {
        edgePadding: { top: 60, right: 40, bottom: 60, left: 40 }, animated: true,
      });
    } else if (pts.length === 1) {
      mapRef.current.animateToRegion({
        latitude: pts[0].latitude, longitude: pts[0].longitude,
        latitudeDelta: 0.015, longitudeDelta: 0.015,
      });
    }
  }, [pickup, destination, stops]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={DEFAULT_REGION}
      onPress={onMapPress ? (e: MapPressEvent) => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        onMapPress({ lat: latitude, lng: longitude });
      } : undefined}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {/* ── Online drivers ── */}
      {onlineDrivers.map(d => (
        <Marker
          key={d.user_id}
          coordinate={{ latitude: d.current_lat, longitude: d.current_lng }}
          title={`Driver · ${d.vehicle_type ?? ''}`}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.driverMarker}>
            <SymbolView
              name={VEHICLE_SYMBOL[d.vehicle_type ?? ''] ?? 'car.fill'}
              style={styles.driverMarkerIcon}
              tintColor="#fff"
              resizeMode="scaleAspectFit"
            />
          </View>
        </Marker>
      ))}

      {/* ── Pickup ── */}
      {pickup && (
        <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Pickup" pinColor="#22c55e" />
      )}

      {/* ── Destination ── */}
      {destination && (
        <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title="Destination" pinColor="#ef4444" />
      )}

      {/* ── Stops ── */}
      {stops.filter(s => s.lat !== 0).map((s, i) => (
        <Marker key={i} coordinate={{ latitude: s.lat, longitude: s.lng }} title={`Stop ${i + 1}`} pinColor="#D4AF37" />
      ))}

      {/* ── Route ── */}
      {routeCoords && routeCoords.length > 1 && (
        <Polyline coordinates={routeCoords} strokeColor="#D4AF37" strokeWidth={4} />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A2744',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  driverMarkerIcon: {
    width: 18,
    height: 18,
  },
});
