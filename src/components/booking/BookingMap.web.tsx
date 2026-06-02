/**
 * BookingMap (web / Leaflet) — pickup, destination, route AND nearby online drivers.
 * Online driver positions update in real time via Supabase subscription + 5-second polling.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
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

export default function BookingMap({
  pickup, destination, stops = [], onMapPress, routeCoords,
}: BookingMapProps) {
  const containerRef = useRef<any>(null);
  const mapRef       = useRef<any>(null);
  const [mapReady, setMapReady]       = useState(false);
  const [onlineDrivers, setOnlineDrivers] = useState<OnlineDriver[]>([]);

  // Per-driver marker refs  { user_id → Leaflet Marker }
  const driverMarkersRef = useRef<Record<string, any>>({});
  // Static markers
  const pickupMarkerRef  = useRef<any>(null);
  const destMarkerRef    = useRef<any>(null);
  const stopMarkersRef   = useRef<any[]>([]);
  const routeLayerRef    = useRef<any>(null);

  // ── Fetch online drivers via backend API ─────────────────────────────────
  const fetchOnlineDrivers = async () => {
    try {
      const data = await DriversAPI.getOnline();
      setOnlineDrivers(data);
    } catch {}
  };

  // ── Bootstrap Leaflet once ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const init = () => {
      const el = containerRef.current;
      if (!el || (el as any)._lmap) return;

      const L = (window as any).L;
      // Default center: Siem Reap
      const map = L.map(el, { center: [13.3671, 103.8498], zoom: 14 });
      (el as any)._lmap = map;
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);

      if (onMapPress) {
        map.on('click', (e: any) => onMapPress({ lat: e.latlng.lat, lng: e.latlng.lng }));
      }

      setTimeout(() => { map.invalidateSize(); setMapReady(true); }, 150);
    };

    if ((window as any).L) {
      init();
    } else {
      if (!document.getElementById('lf-css')) {
        const link = document.createElement('link');
        link.id = 'lf-css'; link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = init;
      document.head.appendChild(s);
    }

    return () => {
      const el = containerRef.current;
      if (el?._lmap) { el._lmap.remove(); el._lmap = null; mapRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch drivers + subscribe + poll ─────────────────────────────────────
  useEffect(() => {
    fetchOnlineDrivers();
    const channel = supabase.channel('booking-drivers-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'driver_profiles' }, () => fetchOnlineDrivers())
      .subscribe();
    const poll = setInterval(fetchOnlineDrivers, 5000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, []);

  // ── Sync online driver markers to Leaflet ─────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;

    const existingIds = new Set(Object.keys(driverMarkersRef.current));
    const currentIds  = new Set(onlineDrivers.map(d => d.user_id));

    // Remove markers for drivers that went offline
    existingIds.forEach(id => {
      if (!currentIds.has(id)) {
        map.removeLayer(driverMarkersRef.current[id]);
        delete driverMarkersRef.current[id];
      }
    });

    // Add or move markers
    onlineDrivers.forEach(d => {
      const ll = [d.current_lat, d.current_lng];
      if (driverMarkersRef.current[d.user_id]) {
        driverMarkersRef.current[d.user_id].setLatLng(ll);
      } else {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:28px;height:28px;
            background:#1A2744;
            border-radius:50%;
            border:2.5px solid #D4AF37;
            box-shadow:0 2px 8px rgba(0,0,0,0.45);
            display:flex;align-items:center;justify-content:center;
            font-size:14px;cursor:pointer;
          ">🛺</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        driverMarkersRef.current[d.user_id] = L.marker(ll, { icon })
          .bindPopup(`<b>${d.vehicle_type ?? 'Driver'}</b><br>Available`)
          .addTo(map);
      }
    });
  }, [onlineDrivers, mapReady]);

  // ── Pickup marker ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (pickupMarkerRef.current) { map.removeLayer(pickupMarkerRef.current); pickupMarkerRef.current = null; }
    if (pickup) {
      pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: dotIcon(L, '#22c55e') })
        .bindPopup('Pickup').addTo(map);
    }
    fitBounds(map, pickup, destination, stops);
  }, [pickup, mapReady]);

  // ── Destination marker ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (destMarkerRef.current) { map.removeLayer(destMarkerRef.current); destMarkerRef.current = null; }
    if (destination) {
      destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: dotIcon(L, '#ef4444') })
        .bindPopup('Destination').addTo(map);
    }
    fitBounds(map, pickup, destination, stops);
  }, [destination, mapReady]);

  // ── Stop markers ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    stopMarkersRef.current.forEach(m => map.removeLayer(m));
    stopMarkersRef.current = stops
      .filter(s => s.lat !== 0)
      .map((s, i) => L.marker([s.lat, s.lng], { icon: dotIcon(L, '#D4AF37') }).bindPopup(`Stop ${i + 1}`).addTo(map));
  }, [stops, mapReady]);

  // ── Route polyline ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const L   = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (routeLayerRef.current) { map.removeLayer(routeLayerRef.current); routeLayerRef.current = null; }
    if (routeCoords && routeCoords.length > 1) {
      const latlngs = routeCoords.map(c => [c.latitude, c.longitude]);
      routeLayerRef.current = L.polyline(latlngs, { color: '#D4AF37', weight: 5, opacity: 0.9 }).addTo(map);
    }
  }, [routeCoords, mapReady]);

  return (
    <View style={styles.wrap}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function dotIcon(L: any, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function fitBounds(map: any, pickup: LatLng | null, dest: LatLng | null, stops: LatLng[]) {
  const pts: [number, number][] = [];
  if (pickup)  pts.push([pickup.lat,  pickup.lng]);
  if (dest)    pts.push([dest.lat,    dest.lng]);
  stops.filter(s => s.lat !== 0).forEach(s => pts.push([s.lat, s.lng]));
  if (pts.length >= 2) map.fitBounds(pts, { padding: [50, 50] });
  else if (pts.length === 1) map.setView(pts[0], 15);
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
});
