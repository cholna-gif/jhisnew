import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';

export interface VehicleOption {
  type: string;
  icon: string;
  label: string;
  description: string;
  baseFare: number;
  perKm: number;
  maxSeats: number;
}

export const VEHICLE_OPTIONS: VehicleOption[] = [
  { type: 'tuktuk', icon: '🛺', label: 'Tuk Tuk', description: 'Classic Cambodia ride', baseFare: 1.0, perKm: 0.4, maxSeats: 4 },
  { type: 'car', icon: '🚗', label: 'Car', description: 'Comfortable & AC', baseFare: 1.5, perKm: 0.6, maxSeats: 5 },
  { type: 'moto', icon: '🏍️', label: 'Moto', description: 'Fast & affordable', baseFare: 0.75, perKm: 0.3, maxSeats: 1 },
  { type: 'van', icon: '🚐', label: 'Van', description: 'Groups up to 8', baseFare: 2.0, perKm: 0.8, maxSeats: 8 },
];

export const calculateFare = (vehicle: VehicleOption, distanceKm: number) =>
  vehicle.baseFare + distanceKm * vehicle.perKm;

export const SHARE_RIDE_DISCOUNT = 0.25;

export const calculateShareFare = (vehicle: VehicleOption, distanceKm: number) => {
  const standard = calculateFare(vehicle, distanceKm);
  return standard * (1 - SHARE_RIDE_DISCOUNT);
};

interface VehicleSelectorProps {
  selected: string;
  onSelect: (type: string) => void;
  distanceKm: number;
  durationMin: number;
  isShareRide?: boolean;
  groupSize?: number;
}

export default function VehicleSelector({
  selected,
  onSelect,
  distanceKm,
  durationMin,
  isShareRide = false,
  groupSize = 1,
}: VehicleSelectorProps) {
  const availableVehicles = VEHICLE_OPTIONS.filter(v => v.maxSeats >= groupSize);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {availableVehicles.map(v => {
        const standardFare = calculateFare(v, distanceKm);
        const fare = isShareRide ? calculateShareFare(v, distanceKm) : standardFare;
        const isSelected = selected === v.type;
        return (
          <TouchableOpacity
            key={v.type}
            onPress={() => onSelect(v.type)}
            style={[styles.card, isSelected && styles.cardSelected]}
          >
            <Text style={styles.icon}>{v.icon}</Text>
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{v.label}</Text>
            <Text style={styles.baseFare}>From ${v.baseFare.toFixed(2)}</Text>
            {isShareRide ? (
              <>
                <Text style={styles.strikethrough}>${standardFare.toFixed(2)}</Text>
                <Text style={styles.shareFare}>${fare.toFixed(2)}</Text>
              </>
            ) : (
              <Text style={styles.fare}>${fare.toFixed(2)}</Text>
            )}
            <Text style={styles.seats}>{v.maxSeats} seats</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginVertical: 4 },
  card: {
    alignItems: 'center',
    minWidth: 80,
    padding: 12,
    marginRight: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#243059',
  },
  cardSelected: {
    borderColor: '#D4AF37',
    backgroundColor: 'rgba(212,175,55,0.15)',
  },
  icon: { fontSize: 24, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#fff' },
  labelSelected: { color: '#D4AF37' },
  baseFare: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  fare: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  strikethrough: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textDecorationLine: 'line-through' },
  shareFare: { fontSize: 12, color: '#4ade80', fontWeight: '700' },
  seats: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
});
