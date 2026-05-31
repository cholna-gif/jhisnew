import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LatLng } from '@/types';

interface BookingMapProps {
  pickup: LatLng | null;
  destination: LatLng | null;
  stops?: LatLng[];
  onMapPress?: (latlng: { lat: number; lng: number }) => void;
  routeCoords?: { latitude: number; longitude: number }[];
}

export default function BookingMap({
  pickup,
  destination,
  stops = [],
  onMapPress,
  routeCoords,
}: BookingMapProps) {
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const container = mapRef.current;
    if (!container) return;

    // Load Leaflet CSS + JS dynamically
    if (!(window as any)._leafletLoaded) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        (window as any)._leafletLoaded = true;
        initMap();
      };
      document.head.appendChild(script);
    } else {
      initMap();
    }

    function initMap() {
      const L = (window as any).L;
      if (!L) return;

      // Destroy previous map instance if any
      if ((container as any)._leaflet_id) {
        (container as any)._map?.remove();
      }

      const defaultCenter = pickup
        ? [pickup.lat, pickup.lng]
        : [11.5564, 104.9282]; // Phnom Penh

      const map = L.map(container, {
        center: defaultCenter,
        zoom: pickup && destination ? 13 : 14,
      });
      (container as any)._map = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      // Markers
      const greenIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#22c55e;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
      const redIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#ef4444;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
      const goldIcon = L.divIcon({ className: '', html: '<div style="width:12px;height:12px;background:#D4AF37;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });

      if (pickup) L.marker([pickup.lat, pickup.lng], { icon: greenIcon }).bindPopup('Pickup: ' + pickup.address).addTo(map);
      if (destination) L.marker([destination.lat, destination.lng], { icon: redIcon }).bindPopup('Destination: ' + destination.address).addTo(map);
      stops.filter(s => s.lat !== 0).forEach((s, i) => {
        L.marker([s.lat, s.lng], { icon: goldIcon }).bindPopup(`Stop ${i + 1}: ${s.address}`).addTo(map);
      });

      // Route polyline
      if (routeCoords && routeCoords.length > 1) {
        L.polyline(routeCoords.map(c => [c.latitude, c.longitude]), { color: '#D4AF37', weight: 4, opacity: 0.9 }).addTo(map);
      }

      // Fit bounds
      const points: [number, number][] = [];
      if (pickup) points.push([pickup.lat, pickup.lng]);
      if (destination) points.push([destination.lat, destination.lng]);
      stops.filter(s => s.lat !== 0).forEach(s => points.push([s.lat, s.lng]));
      if (points.length >= 2) map.fitBounds(points, { padding: [40, 40] });

      // Click handler
      if (onMapPress) {
        map.on('click', (e: any) => {
          onMapPress({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      // Resize fix
      setTimeout(() => map.invalidateSize(), 100);
    }

    return () => {
      const m = (container as any)._map;
      if (m) { m.remove(); (container as any)._map = null; }
    };
  }, [pickup, destination, stops, routeCoords, onMapPress]);

  return (
    <View style={styles.wrapper}>
      {/* The div that Leaflet mounts into */}
      <div
        ref={mapRef}
        style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden' }}
      />
      {onMapPress && !pickup && (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Click map to set pickup</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, width: '100%', height: '100%', overflow: 'hidden' },
  hint: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  hintText: {
    backgroundColor: 'rgba(26,39,68,0.85)',
    color: '#D4AF37',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    fontSize: 13,
    fontWeight: '600',
    overflow: 'hidden',
  },
});
