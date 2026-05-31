/**
 * LocationSearch — Grab-style autocomplete using Photon (Komoot).
 * No API key required. Suggestions appear instantly as the user types.
 * Shows popular Cambodia places when focused with empty input.
 */
import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { LatLng } from '@/types';

// ── Popular Cambodia places shown before user types ───────────────────────────
const POPULAR: Suggestion[] = [
  { id: 'angkor-wat',   name: 'Angkor Wat',            sub: 'Siem Reap, Cambodia',                lat: 13.4125, lng: 103.8670 },
  { id: 'sr-airport',   name: 'Siem Reap Airport',     sub: 'National Road 6, Siem Reap',        lat: 13.4107, lng: 103.8129 },
  { id: 'pub-street',   name: 'Pub Street',             sub: 'Siem Reap, Cambodia',               lat: 13.3622, lng: 103.8566 },
  { id: 'pp-airport',   name: 'Phnom Penh Airport',    sub: 'Pochentong Blvd, Phnom Penh',       lat: 11.5466, lng: 104.8440 },
  { id: 'royal-palace', name: 'Royal Palace',          sub: 'Samdach Sothearos Blvd, Phnom Penh',lat: 11.5648, lng: 104.9309 },
  { id: 'riverside-pp', name: 'Riverside Phnom Penh',  sub: 'Phnom Penh, Cambodia',              lat: 11.5696, lng: 104.9282 },
  { id: 'angkor-thom',  name: 'Angkor Thom',           sub: 'Siem Reap, Cambodia',               lat: 13.4414, lng: 103.8588 },
  { id: 'bayon',        name: 'Bayon Temple',           sub: 'Angkor, Siem Reap',                 lat: 13.4413, lng: 103.8592 },
];

interface Suggestion {
  id: string;
  name: string;
  sub: string;
  lat: number;
  lng: number;
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

// Cambodia bounding box for Photon
const BBOX = '102.1,10.4,107.6,14.7';

export default function LocationSearch({
  label, value, onChange, onSelect, onClear, onFocus, showGps, onGps,
}: LocationSearchProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [focused,     setFocused]     = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef   = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { width: SW, height: SH } = Dimensions.get('window');

  // ── Photon autocomplete ───────────────────────────────────────────────────
  const search = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setSuggestions(POPULAR);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=8&lang=en&bbox=${BBOX}`;
      const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();

      const results: Suggestion[] = (data.features ?? []).map((f: any, i: number) => {
        const p    = f.properties ?? {};
        const name = p.name || p.street || p.district || p.city || 'Location';
        const parts = [p.street, p.district, p.city, p.county, p.country]
          .filter(Boolean)
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .filter(v => v !== name)
          .slice(0, 3);
        return {
          id:  `photon-${i}-${f.geometry?.coordinates?.join(',')}`,
          name,
          sub: parts.join(', ') || p.country || 'Cambodia',
          lat: f.geometry?.coordinates?.[1] ?? 0,
          lng: f.geometry?.coordinates?.[0] ?? 0,
        };
      }).filter((s: Suggestion) => s.lat !== 0);

      setSuggestions(results.length > 0 ? results : POPULAR);
    } catch {
      setSuggestions(POPULAR);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setSuggestions(POPULAR);
      setLoading(false);
    } else {
      setLoading(true);
      debounceRef.current = setTimeout(() => search(text), 300);
    }
  };

  const handleFocus = () => {
    setFocused(true);
    setShowDropdown(true);
    onFocus?.();
    if (value.trim().length < 2) setSuggestions(POPULAR);
    else search(value);
  };

  const closeDropdown = () => {
    setFocused(false);
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  const handleSelect = (item: Suggestion) => {
    closeDropdown();
    onChange(item.name);
    onSelect({ lat: item.lat, lng: item.lng, address: `${item.name}, ${item.sub}` });
  };

  const handleClear = () => {
    onChange('');
    setSuggestions(POPULAR);
    onClear?.();
    inputRef.current?.focus();
  };

  const dropdownVisible = showDropdown && (suggestions.length > 0 || loading);

  return (
    <View style={styles.wrapper}>

      {/* ── Full-screen backdrop ─────────────────────────────────────────────
          Absolutely positioned far outside the component bounds so it covers
          the entire screen. React Native does NOT clip absolute children by
          default, so touches on the map / empty area all hit this Pressable.
          zIndex sits between the rest of the UI (< 998) and the dropdown (999).
      ── */}
      {dropdownVisible && (
        <Pressable
          style={{
            position: 'absolute',
            top: -SH,
            left: -SW,
            width: SW * 3,
            height: SH * 3,
            zIndex: 998,
          }}
          onPress={closeDropdown}
        />
      )}

      {/* ── Input row ── */}
      <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
        <SymbolView name="location.fill" style={styles.pinIcon} tintColor="rgba(255,255,255,0.55)" resizeMode="scaleAspectFit" />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={label}
          placeholderTextColor="rgba(255,255,255,0.45)"
          value={value}
          onChangeText={handleChange}
          onFocus={handleFocus}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator size="small" color="#D4AF37" style={{ marginLeft: 6 }} />}
        {!loading && value.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={styles.clearCircle}>
              <Text style={styles.clearX}>✕</Text>
            </View>
          </TouchableOpacity>
        )}
        {showGps && value.length === 0 && (
          <TouchableOpacity onPress={onGps} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
            <View style={styles.gpsCircle}>
              <SymbolView name="location.circle.fill" style={{ width: 16, height: 16 }} tintColor="#D4AF37" resizeMode="scaleAspectFit" />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Dropdown (zIndex: 999 — above the backdrop) ── */}
      {dropdownVisible && (
        <View style={styles.dropdown}>
          {/* GPS shortcut row */}
          {showGps && onGps && (
            <TouchableOpacity style={styles.gpsRow} onPress={() => { closeDropdown(); onGps(); }}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(212,175,55,0.15)' }]}>
                <SymbolView name="location.circle.fill" style={styles.iconBoxSymbol} tintColor="#D4AF37" resizeMode="scaleAspectFit" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggName}>Use my current location</Text>
                <Text style={styles.suggSub}>GPS — pin your exact position</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* Section label for popular places */}
          {value.trim().length < 2 && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Popular places</Text>
            </View>
          )}

          <FlatList
            data={suggestions}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="always"
            scrollEnabled={suggestions.length > 4}
            style={{ maxHeight: 300 }}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[styles.suggRow, index === suggestions.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <View style={styles.iconBox}>
                  <SymbolView
                    name="location.fill"
                    style={styles.iconBoxSymbol}
                    tintColor="rgba(255,255,255,0.6)"
                    resizeMode="scaleAspectFit"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.suggSub}  numberOfLines={1}>{item.sub}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 100,
  },

  // ── Input ──
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#243059',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    gap: 8,
  },
  inputRowFocused: {
    borderColor: '#D4AF37',
    backgroundColor: '#2a3868',
  },
  pinIcon: { width: 15, height: 15, opacity: 0.7 },
  iconBoxSymbol: { width: 18, height: 18 },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },
  clearCircle: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  clearX: { color: '#fff', fontSize: 11, fontWeight: '700' },
  gpsCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(212,175,55,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)',
  },

  // ── Dropdown ──
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: '#1e2d52',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    zIndex: 999,
    elevation: 12,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.5)' } : {
      shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.45, shadowRadius: 14,
    }),
  },

  // GPS first row
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },

  // Section header
  sectionHeader: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sectionHeaderText: {
    fontSize: 11,
    color: '#D4AF37',
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Suggestion rows
  suggRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  iconBox: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  suggName: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 19,
  },
  suggSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 17,
    marginTop: 1,
  },
});
