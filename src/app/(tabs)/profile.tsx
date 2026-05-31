import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatUsd } from '@/lib/currency';

function SectionHeader({ symbol, title }: { symbol: SFSymbol; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <SymbolView name={symbol} style={{ width: 15, height: 15 }} tintColor="#374151" resizeMode="scaleAspectFit" />
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#374151' }}>{title}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState('');
  const [walletBalance, setWalletBalance] = useState(profile?.wallet_balance ?? 0);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [rideCount, setRideCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('full_name, phone, wallet_balance').eq('id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setFullName((data as any).full_name || '');
          setPhone((data as any).phone || '');
          setWalletBalance((data as any).wallet_balance ?? 0);
        }
      });
    supabase.from('rides' as any).select('id', { count: 'exact' }).eq('passenger_id', user.id).eq('status', 'completed')
      .then(({ count }) => setRideCount(count ?? 0));
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: fullName, phone }).eq('id', user.id);
    if (error) Alert.alert('Error', 'Failed to save profile');
    else { await refreshProfile(); Alert.alert('Saved', 'Profile updated!'); }
    setSaving(false);
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (isNaN(amount) || amount <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    setToppingUp(true);
    const newBalance = walletBalance + amount;
    const { error } = await supabase.from('profiles').update({ wallet_balance: newBalance }).eq('id', user!.id);
    if (error) Alert.alert('Error', 'Top up failed');
    else {
      setWalletBalance(newBalance);
      setTopUpAmount('');
      setShowTopUp(false);
      Alert.alert('Top Up Success', `${formatUsd(amount)} added to your wallet!`);
    }
    setToppingUp(false);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        {/* Avatar + name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {fullName ? fullName.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
          <Text style={styles.nameText}>{fullName || 'Passenger'}</Text>
          <Text style={styles.emailText}>{user?.email}</Text>
          {profile?.is_suspended && (
            <View style={styles.suspendedBadge}>
              <Text style={styles.suspendedBadgeText}>Account Suspended</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{rideCount}</Text>
            <Text style={styles.statLbl}>Total Rides</Text>
          </View>
          <View style={[styles.statBox, styles.statBoxMiddle]}>
            <Text style={styles.statNum}>{formatUsd(walletBalance)}</Text>
            <Text style={styles.statLbl}>Wallet Balance</Text>
          </View>
          <View style={styles.statBox}>
            <SymbolView name="car.2.fill" style={{ width: 22, height: 22 }} tintColor="#1A2744" resizeMode="scaleAspectFit" />
            <Text style={styles.statLbl}>Passenger</Text>
          </View>
        </View>

        {/* Wallet */}
        <View style={styles.section}>
          <SectionHeader symbol="wallet.pass.fill" title="Wallet" />
          <View style={styles.walletRow}>
            <Text style={styles.walletBalance}>{formatUsd(walletBalance)}</Text>
            <TouchableOpacity
              style={styles.topUpBtn}
              onPress={() => setShowTopUp(!showTopUp)}
            >
              <Text style={styles.topUpBtnText}>Top Up</Text>
            </TouchableOpacity>
          </View>
          {showTopUp && (
            <View style={styles.topUpForm}>
              <TextInput
                style={styles.input}
                placeholder="Amount in USD (e.g. 10.00)"
                placeholderTextColor="#9ca3af"
                value={topUpAmount}
                onChangeText={setTopUpAmount}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity
                style={[styles.saveBtn, toppingUp && styles.saveBtnDisabled]}
                onPress={handleTopUp}
                disabled={toppingUp}
              >
                {toppingUp ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Add to Wallet</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Edit profile */}
        <View style={styles.section}>
          <SectionHeader symbol="person.crop.circle" title="Edit Profile" />
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your full name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+855 ..."
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
            />
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <SectionHeader symbol="gearshape" title="Settings" />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Push Notifications</Text>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ false: '#d1d5db', true: '#1A2744' }}
              thumbColor={notifications ? '#D4AF37' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* Account info */}
        <View style={styles.section}>
          <SectionHeader symbol="info.circle" title="Account" />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Member since</Text>
            <Text style={styles.infoValue}>
              {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : '—'}
            </Text>
          </View>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <SectionHeader symbol="questionmark.circle" title="Support" />
          <TouchableOpacity style={styles.supportRow} onPress={() => Alert.alert('Support', 'Email: support@jih.app\nTelegram: @jihsupport')}>
            <Text style={styles.supportText}>Contact Support</Text>
            <Text style={styles.supportArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.supportRow} onPress={() => Alert.alert('About', 'Jih Passenger App v1.0\nBuilt for Cambodia.')}>
            <Text style={styles.supportText}>About Jih</Text>
            <Text style={styles.supportArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatarSection: { alignItems: 'center', paddingVertical: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, color: '#D4AF37', fontWeight: '700' },
  nameText: { fontSize: 20, fontWeight: '700', color: '#111' },
  emailText: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  suspendedBadge: { marginTop: 8, backgroundColor: '#fef2f2', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  suspendedBadgeText: { color: '#dc2626', fontSize: 12, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 1, backgroundColor: '#e5e7eb', borderRadius: 12, overflow: 'hidden' },
  statBox: { flex: 1, backgroundColor: '#fff', padding: 16, alignItems: 'center', gap: 4 },
  statBoxMiddle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#e5e7eb' },
  statNum: { fontSize: 18, fontWeight: '700', color: '#1A2744' },
  statLbl: { fontSize: 11, color: '#9ca3af', textAlign: 'center' },
  section: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151' },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletBalance: { fontSize: 24, fontWeight: '700', color: '#1A2744' },
  topUpBtn: { backgroundColor: '#1A2744', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  topUpBtnText: { color: '#D4AF37', fontWeight: '600', fontSize: 14 },
  topUpForm: { gap: 10 },
  fieldGroup: { gap: 4 },
  fieldLabel: { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fff',
  },
  saveBtn: { backgroundColor: '#1A2744', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { fontSize: 14, color: '#374151' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 13, color: '#9ca3af' },
  infoValue: { fontSize: 13, color: '#374151', fontWeight: '500' },
  supportRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  supportText: { fontSize: 14, color: '#374151' },
  supportArrow: { color: '#9ca3af', fontSize: 14 },
  signOutBtn: {
    borderWidth: 2,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});
