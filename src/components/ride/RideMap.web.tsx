/**
 * RideMap — web (Leaflet via CDN)
 *
 * Driver position is kept in React state so there are no stale-closure bugs.
 * Three update mechanisms: initial fetch, Supabase realtime, 4-second polling.
 * Leaflet marker and route are updated imperatively when driverPos state changes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

interface Props {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  driverId: string | null;
  rideStatus: string;
  onEtaUpdate?: (etaMinutes: number | null) => void;
}

type Pos = { lat: number; lng: number };

export default function RideMap({
  pickupLat, pickupLng, destLat, destLng,
  driverId, rideStatus, onEtaUpdate,
}: Props) {
  const containerRef    = useRef<any>(null);
  const mapRef          = useRef<any>(null);     // Leaflet map instance
  const driverMarkerRef = useRef<any>(null);     // Leaflet driver Marker
  const routeLayerRef   = useRef<any>(null);     // Leaflet Polyline

  const [driverPos, setDriverPos] = useState<Pos | null>(null);
  const [mapReady,  setMapReady]  = useState(false);

  // ── Fetch helper ─────────────────────────────────────────────────────────
  const fetchDriverLoc = async (id: string) => {
    const { data } = await supabase
      .from('driver_profiles' as any)
      .select('current_lat, current_lng')
      .eq('user_id', id)
      .maybeSingle() as any;
    if (data?.current_lat && data?.current_lng) {
      setDriverPos({ lat: data.current_lat, lng: data.current_lng });
    }
  };

  // ── Bootstrap Leaflet map once ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const init = () => {
      const el = containerRef.current;
      if (!el || (el as any)._leafletMap) return;

      const L   = (window as any).L;
      const map = L.map(el, { center: [pickupLat, pickupLng], zoom: 14, zoomControl: true });
      (el as any)._leafletMap = map;
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      // Pickup pin
      L.marker([pickupLat, pickupLng], { icon: dotIcon(L, '#22c55e') })
        .bindPopup('<b>Pickup</b>').addTo(map);

      // Destination pin
      L.marker([destLat, destLng], { icon: dotIcon(L, '#ef4444') })
        .bindPopup('<b>Destination</b>').addTo(map);

      // Fit pickup + destination
      map.fitBounds([[pickupLat, pickupLng], [destLat, destLng]], { padding: [40, 40] });
      setTimeout(() => { map.invalidateSize(); setMapReady(true); }, 150);
    };

    if ((window as any).L) {
      init();
    } else {
      // Load Leaflet CSS
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id   = 'leaflet-css';
        link.rel  = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      // Load Leaflet JS
      const script   = document.createElement('script');
      script.src     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload  = init;
      document.head.appendChild(script);
    }

    return () => {
      const el = containerRef.current;
      if (el && (el as any)._leafletMap) {
        (el as any)._leafletMap.remove();
        (el as any)._leafletMap = null;
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subscribe to driver location: fetch + realtime + polling ─────────────
  useEffect(() => {
    if (!driverId) return;

    fetchDriverLoc(driverId);

    const channel = supabase
      .channel(`driver-loc-web-${driverId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'driver_profiles', filter: `user_id=eq.${driverId}`,
      }, (payload: any) => {
        const { current_lat, current_lng } = payload.new ?? {};
        if (current_lat && current_lng) setDriverPos({ lat: current_lat, lng: current_lng });
      })
      .subscribe();

    const poll = setInterval(() => fetchDriverLoc(driverId), 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [driverId]);

  // ── Update Leaflet driver marker whenever driverPos changes ───────────────
  useEffect(() => {
    if (!mapReady || !driverPos) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;

    const ll = [driverPos.lat, driverPos.lng];

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLatLng(ll);
    } else {
      driverMarkerRef.current = L.marker(ll, { icon: driverIcon(L) })
        .bindPopup('<b>🛺 Your Driver</b>')
        .addTo(map);
    }

    // Recalculate route
    const tLat = rideStatus === 'in_progress' ? destLat   : pickupLat;
    const tLng = rideStatus === 'in_progress' ? destLng   : pickupLng;

    fetch(
      `https://router.project-osrm.org/route/v1/driving/` +
      `${driverPos.lng},${driverPos.lat};${tLng},${tLat}` +
      `?overview=full&geometries=geojson`
    )
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.[0]) return;
        const latlngs = (data.routes[0].geometry.coordinates as [number, number][])
          .map(([lng, lat]) => [lat, lng]);
        if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
        routeLayerRef.current = L.polyline(latlngs, { color: '#D4AF37', weight: 5, opacity: 0.9 }).addTo(map);
        onEtaUpdate?.(Math.max(1, Math.round(data.routes[0].duration / 60)));

        // Fit all three points
        const bounds = [[pickupLat, pickupLng], [destLat, destLng], [driverPos.lat, driverPos.lng]];
        map.fitBounds(bounds as any, { padding: [40, 40] });
      })
      .catch(() => onEtaUpdate?.(null));
  }, [driverPos, mapReady, rideStatus, pickupLat, pickupLng, destLat, destLng]);

  return (
    <View style={styles.wrap}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!driverPos && driverId && (
        <View style={styles.noLocBanner}>
          <Text style={styles.noLocText}>📡 Waiting for driver location…</Text>
        </View>
      )}
    </View>
  );
}

// ── Leaflet icon helpers ──────────────────────────────────────────────────────
function dotIcon(L: any, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function driverIcon(L: any) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;
      background:#1A2744;
      border-radius:50%;
      border:3px solid #D4AF37;
      box-shadow:0 2px 10px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
      font-size:15px;
    ">🛺</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', height: '100%', position: 'relative' },
  noLocBanner: {
    position: 'absolute',
    top: 12, left: 12, right: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    zIndex: 999,
  },
  noLocText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
});
