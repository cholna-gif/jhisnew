import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, MapPressEvent, Region } from 'react-native-maps';
import { LatLng } from '@/types';

interface BookingMapProps {
  pickup: LatLng | null;
  destination: LatLng | null;
  stops?: LatLng[];
  onMapPress?: (latlng: { lat: number; lng: number }) => void;
  routeCoords?: { latitude: number; longitude: number }[];
}

const DEFAULT_REGION: Region = {
  latitude: 11.5564,
  longitude: 104.9282,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function BookingMap({
  pickup,
  destination,
  stops = [],
  onMapPress,
  routeCoords,
}: BookingMapProps) {
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const points: { latitude: number; longitude: number }[] = [];
    if (pickup) points.push({ latitude: pickup.lat, longitude: pickup.lng });
    if (destination) points.push({ latitude: destination.lat, longitude: destination.lng });
    stops.forEach(s => points.push({ latitude: s.lat, longitude: s.lng }));
    if (points.length >= 2) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 60, right: 40, bottom: 60, left: 40 },
        animated: true,
      });
    } else if (points.length === 1) {
      mapRef.current.animateToRegion({
        latitude: points[0].latitude,
        longitude: points[0].longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  }, [pickup, destination, stops]);

  const handlePress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onMapPress?.({ lat: latitude, lng: longitude });
  };

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFillObject}
      initialRegion={DEFAULT_REGION}
      onPress={onMapPress ? handlePress : undefined}
      showsUserLocation
      showsMyLocationButton={false}
    >
      {pickup && (
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          title="Pickup"
          pinColor="#22c55e"
        />
      )}
      {destination && (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lng }}
          title="Destination"
          pinColor="#ef4444"
        />
      )}
      {stops.filter(s => s.lat !== 0).map((s, i) => (
        <Marker
          key={i}
          coordinate={{ latitude: s.lat, longitude: s.lng }}
          title={`Stop ${i + 1}`}
          pinColor="#D4AF37"
        />
      ))}
      {routeCoords && routeCoords.length > 1 && (
        <Polyline
          coordinates={routeCoords}
          strokeColor="#D4AF37"
          strokeWidth={4}
        />
      )}
    </MapView>
  );
}
