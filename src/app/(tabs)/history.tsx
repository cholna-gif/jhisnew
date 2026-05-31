import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatDualCurrency } from '@/lib/currency';
import { Ride } from '@/types';

type Section = 'upcoming' | 'scheduled' | 'past';

const STATUS_PILL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Looking for driver', color: '#6b7280', bg: '#f3f4f6' },
  matched: { label: 'Driver on the way', color: '#7c3aed', bg: '#ede9fe' },
  arrived: { label: 'Driver arrived', color: '#92400e', bg: '#fef3c7' },
  in_progress: { label: 'Ride in progress', color: '#1d4ed8', bg: '#dbeafe' },
  completed: { label: 'Completed', color: '#166534', bg: '#dcfce7' },
  cancelled: { label: 'Cancelled', color: '#b91c1c', bg: '#fee2e2' },
  scheduled: { label: 'Scheduled', color: '#44403c', bg: '#f5f5f4' },
};

const PAYMENT_SYMBOL: Record<string, string> = {
  cash: 'banknote.fill', card: 'creditcard.fill', wallet: 'wallet.pass.fill',
  aba: 'building.columns.fill', wing: 'smartphone',
};

export default function HistoryScreen() {
  const { user } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>('upcoming');
  const [selected, setSelected] = useState<Ride | null>(null);
  const [profiles, setProfiles] = useState<Record<string, any>>({});

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [ridesRes, profRes] = await Promise.all([
      supabase.from('rides' as any).select('*').eq('passenger_id', user.id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setRides((ridesRes.data || []) as Ride[]);
    const m: Record<string, any> = {};
    ((profRes.data || []) as any[]).forEach((p: any) => { m[p.id] = p; });
    setProfiles(m);
    setLoading(false);
  }, [user]);

  // Refetch every time this tab comes into focus so new rides appear immediately
  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  // Realtime subscription — catches live changes while the tab is open
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`history-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `passenger_id=eq.${user.id}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#1A2744" />
      </SafeAreaView>
    );
  }

  const activeStatuses = ['pending', 'matched', 'arrived', 'in_progress'];
  const scheduled = rides.filter(r => r.status === 'scheduled');
  const upcoming = rides.filter(r => activeStatuses.includes(r.status));
  const past = rides.filter(r => !activeStatuses.includes(r.status) && r.status !== 'scheduled');

  const completedRides = past.filter(r => r.status === 'completed');
  const now = new Date();
  const thisMonthCompleted = completedRides.filter(r => {
    if (!r.completed_at) return false;
    const d = new Date(r.completed_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthSpent = thisMonthCompleted.reduce((s, r) => s + (r.final_fare || r.estimated_fare || r.offered_fare || 0), 0);
  const avgFare = thisMonthCompleted.length > 0 ? monthSpent / thisMonthCompleted.length : 0;
  const methodCounts: Record<string, number> = {};
  thisMonthCompleted.forEach(r => {
    const m = r.payment_method || 'cash';
    methodCounts[m] = (methodCounts[m] || 0) + 1;
  });
  const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'cash';

  if (rides.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <SymbolView name="clock" style={styles.emptyIcon} tintColor="#9ca3af" resizeMode="scaleAspectFit" />
        <Text style={styles.emptyTitle}>No rides yet</Text>
        <Text style={styles.emptyText}>Book your first ride from the Book tab!</Text>
      </SafeAreaView>
    );
  }

  const currentList = activeSection === 'upcoming' ? upcoming : activeSection === 'scheduled' ? scheduled : past;

  const handleCancelScheduled = async (rideId: string) => {
    const target = rides.find(r => r.id === rideId);
    if (target?.payment_method === 'wallet' && target?.payment_status === 'paid' && user) {
      const refundAmount = target.estimated_fare || target.offered_fare || 0;
      const { data: prof } = await supabase.from('profiles').select('wallet_balance').eq('id', user.id).single();
      const newBalance = ((prof as any)?.wallet_balance ?? 0) + refundAmount;
      await supabase.from('profiles').update({ wallet_balance: newBalance }).eq('id', user.id);
    }
    const isPaid = target?.payment_status === 'paid';
    await supabase.from('rides' as any).update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Cancelled by passenger',
      payment_status: isPaid ? 'refunded' : 'pending',
      final_fare: null,
    } as any).eq('id', rideId);
    setRides(prev => prev.map(r => r.id === rideId ? { ...r, status: 'cancelled' as any, payment_status: isPaid ? 'refunded' : 'pending', final_fare: undefined } : r));
  };

  const sections: { id: Section; label: string; count: number }[] = [
    { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
    { id: 'scheduled', label: 'Scheduled', count: scheduled.length },
    { id: 'past', label: 'Past', count: past.length },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Section tabs */}
      <View style={styles.tabs}>
        {sections.map(s => (
          <TouchableOpacity
            key={s.id}
            onPress={() => setActiveSection(s.id)}
            style={[styles.tab, activeSection === s.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeSection === s.id && styles.tabTextActive]}>
              {s.label}{s.count > 0 ? ` (${s.count})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* Monthly stats — past tab */}
        {activeSection === 'past' && thisMonthCompleted.length > 0 && (
          <View style={styles.statsCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <SymbolView name="chart.bar.fill" style={{ width: 13, height: 13 }} tintColor="#6b7280" resizeMode="scaleAspectFit" />
              <Text style={styles.statsTitle}>This Month</Text>
            </View>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Total Spent</Text>
                <Text style={styles.statValue}>${monthSpent.toFixed(2)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Total Rides</Text>
                <Text style={styles.statValue}>{thisMonthCompleted.length}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Avg Fare</Text>
                <Text style={styles.statValue}>${avgFare.toFixed(2)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Top Method</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <SymbolView name={(PAYMENT_SYMBOL[topMethod] ?? 'creditcard.fill') as any} style={{ width: 16, height: 16 }} tintColor="#111" resizeMode="scaleAspectFit" />
                  <Text style={styles.statValue}>{topMethod}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {currentList.length === 0 ? (
          <Text style={styles.emptySection}>
            {activeSection === 'scheduled' ? 'No scheduled rides'
              : activeSection === 'upcoming' ? 'No upcoming rides'
              : 'No past rides'}
          </Text>
        ) : (
          currentList.map(r => (
            <View key={r.id}>
              <TouchableOpacity
                style={styles.rideCard}
                onPress={() => setSelected(r)}
              >
                <View style={styles.rideCardTop}>
                  <Text style={styles.rideDate}>
                    {r.status === 'scheduled' && r.scheduled_datetime
                      ? new Date(r.scheduled_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                    }
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: STATUS_PILL[r.status]?.bg ?? '#f3f4f6' }]}>
                    <Text style={[styles.statusPillText, { color: STATUS_PILL[r.status]?.color ?? '#6b7280' }]}>
                      {STATUS_PILL[r.status]?.label ?? r.status}
                    </Text>
                  </View>
                </View>
                <View style={styles.rideAddressRow}>
                  <SymbolView name="location.fill" style={styles.rideAddressIcon} tintColor="#22c55e" resizeMode="scaleAspectFit" />
                  <Text style={styles.rideAddress} numberOfLines={1}>{r.pickup_address || 'Pickup'}</Text>
                </View>
                {r.destination_address && (
                  <View style={styles.rideAddressRow}>
                    <SymbolView name="flag.fill" style={styles.rideAddressIcon} tintColor="#ef4444" resizeMode="scaleAspectFit" />
                    <Text style={styles.rideAddress} numberOfLines={1}>{r.destination_address}</Text>
                  </View>
                )}
                <View style={styles.rideCardBottom}>
                  <Text style={styles.rideVehicle}>{r.vehicle_type || 'Standard'}</Text>
                  {r.status === 'cancelled' ? (
                    <Text style={styles.cancelled}>Cancelled</Text>
                  ) : (
                    <Text style={styles.rideFare}>
                      {formatDualCurrency(r.final_fare || r.estimated_fare || r.offered_fare || 0)}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              {activeSection === 'scheduled' && r.status === 'scheduled' && (
                <TouchableOpacity
                  style={styles.cancelScheduledBtn}
                  onPress={() => handleCancelScheduled(r.id)}
                >
                  <Text style={styles.cancelScheduledText}>Cancel Scheduled Ride</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ride Details</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {selected && (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                <DetailRow label="Date" value={new Date(selected.created_at).toLocaleString()} />
                {selected.scheduled_datetime && (
                  <DetailRow label="Scheduled" value={new Date(selected.scheduled_datetime).toLocaleString()} />
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={[styles.statusPill, { backgroundColor: STATUS_PILL[selected.status]?.bg ?? '#f3f4f6' }]}>
                    <Text style={[styles.statusPillText, { color: STATUS_PILL[selected.status]?.color ?? '#6b7280' }]}>
                      {STATUS_PILL[selected.status]?.label ?? selected.status}
                    </Text>
                  </View>
                </View>
                <DetailRow label="Pickup" value={selected.pickup_address || 'N/A'} />
                <DetailRow label="Destination" value={selected.destination_address || 'N/A'} />
                <DetailRow label="Vehicle" value={selected.vehicle_type || 'Standard'} />
                <DetailRow label="Distance" value={selected.distance_km ? `${selected.distance_km.toFixed(1)} km` : 'N/A'} />
                <DetailRow label="Fare" value={formatDualCurrency(selected.final_fare || selected.estimated_fare || selected.offered_fare || 0)} />
                <DetailRow label="Payment" value={selected.payment_method || 'N/A'} />
                {selected.driver_id && profiles[selected.driver_id] && (
                  <DetailRow label="Driver" value={profiles[selected.driver_id].full_name} />
                )}
                {selected.driver_rating && (
                  <DetailRow label="Your Rating" value={`${'★'.repeat(selected.driver_rating)}${'☆'.repeat(5 - selected.driver_rating)}`} />
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: { width: 52, height: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1A2744' },
  tabText: { fontSize: 13, fontWeight: '500', color: '#9ca3af' },
  tabTextActive: { color: '#1A2744', fontWeight: '700' },
  statsCard: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  statsTitle: { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statItem: { width: '47%' },
  statLabel: { fontSize: 11, color: '#9ca3af' },
  statValue: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 2 },
  emptySection: { textAlign: 'center', color: '#9ca3af', fontSize: 14, paddingVertical: 32 },
  rideCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 2,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.06)',
  },
  rideCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rideDate: { fontSize: 11, color: '#9ca3af', flex: 1 },
  statusPill: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '600' },
  rideAddressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  rideAddressIcon: { width: 12, height: 12 },
  rideAddress: { flex: 1, fontSize: 13, color: '#374151' },
  rideCardBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rideVehicle: { fontSize: 13, color: '#9ca3af', textTransform: 'capitalize' },
  rideFare: { fontSize: 13, fontWeight: '700', color: '#111' },
  cancelled: { fontSize: 13, fontWeight: '600', color: '#ef4444' },
  cancelScheduledBtn: {
    marginTop: -4,
    marginBottom: 12,
    alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  cancelScheduledText: { fontSize: 13, color: '#ef4444', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalClose: { fontSize: 18, color: '#6b7280', padding: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  detailLabel: { fontSize: 13, color: '#6b7280', flex: 1 },
  detailValue: { fontSize: 13, color: '#111', fontWeight: '500', flex: 2, textAlign: 'right' },
});
