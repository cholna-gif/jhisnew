import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { LatLng } from '@/types';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

interface PlaceSuggestion {
  place_id: string;
  description: string;
}

interface LocationSearchProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (loc: LatLng) => void;
  onClear?: () => void;
  onFocus?: () => void;
  showGps?: boolean;
  onGps?: () => void;
}

export default function LocationSearch({
  label,
  value,
  onChange,
  onSelect,
  onClear,
  onFocus,
  showGps,
  onGps,
}: LocationSearchProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (text: string) => {
    if (text.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(text)}&key=${GOOGLE_API_KEY}&components=country:kh`;
      const res = await fetch(url);
      const data = await res.json();
      setSuggestions(data.predictions ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 350);
  };

  const handleSelect = async (item: PlaceSuggestion) => {
    setSuggestions([]);
    setFocused(false);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${item.place_id}&fields=geometry,formatted_address&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      const loc = data.result?.geometry?.location;
      const addr = data.result?.formatted_address ?? item.description;
      if (loc) {
        onSelect({ lat: loc.lat, lng: loc.lng, address: addr });
      }
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        <TextInput
          style={styles.input}
          placeholder={label}
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={value}
          onChangeText={handleChange}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
        />
        {loading && <ActivityIndicator size="small" color="#D4AF37" style={styles.icon} />}
        {!loading && value.length > 0 && (
          <TouchableOpacity onPress={() => { onChange(''); setSuggestions([]); onClear?.(); }}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
        {showGps && !value && (
          <TouchableOpacity onPress={onGps} style={styles.gpsBtn}>
            <Text style={styles.gpsBtnText}>📍</Text>
          </TouchableOpacity>
        )}
      </View>
      {focused && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={item => item.place_id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.suggestion} onPress={() => handleSelect(item)}>
                <Text style={styles.suggestionText} numberOfLines={2}>{item.description}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#243059',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputRowFocused: { borderColor: '#D4AF37' },
  input: { flex: 1, color: '#fff', fontSize: 14 },
  icon: { marginLeft: 8 },
  clearBtn: { color: 'rgba(255,255,255,0.5)', marginLeft: 8, fontSize: 14 },
  gpsBtn: { marginLeft: 8 },
  gpsBtnText: { fontSize: 16 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#1A2744',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    maxHeight: 220,
    zIndex: 100,
    elevation: 8,
    boxShadow: '0px 4px 8px rgba(0,0,0,0.4)',
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  suggestionText: { color: '#fff', fontSize: 13 },
});
