import { Tabs } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';

// ── Brand colors ─────────────────────────────────────────────────────────────
const C = {
  navy:  '#0D1B36',
  white: '#ffffff',
  muted: '#9ca3af',
  border:'#e5e7eb',
};

const TABS = [
  { name: 'index',   label: 'Book',    icon: 'map-pin'       as const },
  { name: 'myride',  label: 'My Ride', icon: 'navigation-2'  as const },
  { name: 'history', label: 'History', icon: 'clock'         as const },
  { name: 'profile', label: 'Profile', icon: 'user'          as const },
];

// Inline type so we don't need @react-navigation/bottom-tabs installed
type TabBarProps = {
  state:       { routes: { key: string; name: string }[]; index: number };
  descriptors: Record<string, { options: { tabBarAccessibilityLabel?: string } }>;
  navigation:  { emit: (e: any) => any; navigate: (name: string) => void };
};

// ── Custom tab bar ────────────────────────────────────────────────────────────
function JihTabBar({ state, descriptors, navigation }: TabBarProps) {
  return (
    <View style={s.wrapper}>
      <View style={s.bar}>
        {state.routes.map((route, i) => {
          const tab    = TABS.find(t => t.name === route.name) ?? TABS[i];
          const active = state.index === i;
          const label  = descriptors[route.key]?.options?.tabBarAccessibilityLabel ?? tab.label;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress', target: route.key, canPreventDefault: true,
            });
            if (!active && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <TouchableOpacity
              key={route.key}
              style={s.tab}
              onPress={onPress}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <View style={[s.iconWrap, active && s.iconWrapActive]}>
                <Feather
                  name={tab.icon}
                  size={20}
                  color={active ? C.white : C.muted}
                  strokeWidth={active ? 2.4 : 1.8}
                />
              </View>
              <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Root tab navigator ────────────────────────────────────────────────────────
export default function AppTabs() {
  return (
    <Tabs
      tabBar={(props) => <JihTabBar {...(props as any)} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"   options={{ title: 'Book' }} />
      <Tabs.Screen name="myride"  options={{ title: 'My Ride' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  wrapper: {
    backgroundColor: C.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 16,
    paddingBottom: Platform.OS === 'ios' ? 26 : 8,
  },
  bar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  iconWrap: {
    width: 48,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: C.navy,
    shadowColor: C.navy,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    color: C.muted,
    letterSpacing: 0.1,
  },
  labelActive: {
    color: C.navy,
    fontWeight: '700',
  },
});
