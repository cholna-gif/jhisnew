import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Clipboard,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { ProfileAPI } from '@/lib/api';

type PaymentMethod = 'cash' | 'card' | 'aba' | 'wing' | 'wallet';

interface PaymentSelectionProps {
  fare: number;
  onConfirm: (method: string, status: string) => void;
  onBack: () => void;
}

const ABA_ACCOUNT = '000 123 456';
const WING_NUMBER = '012 345 678';

const OPTIONS: { id: PaymentMethod; icon: string; label: string; desc: string }[] = [
  { id: 'cash', icon: '💵', label: 'Cash', desc: 'Pay your driver directly after the ride' },
  { id: 'card', icon: '💳', label: 'Card', desc: 'Visa, Mastercard, ABA Card (Demo)' },
  { id: 'aba', icon: '🏦', label: 'ABA', desc: 'Transfer via ABA Bank' },
  { id: 'wing', icon: '📱', label: 'Wing', desc: 'Send via Wing money transfer' },
  { id: 'wallet', icon: '👛', label: 'Wallet', desc: 'Pay from your Jih wallet balance' },
];

export default function PaymentSelection({ fare, onConfirm, onBack }: PaymentSelectionProps) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<PaymentMethod>('cash');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    if (user) {
      ProfileAPI.get().then(p => setWalletBalance(p?.wallet_balance ?? 0));
    }
  }, [user]);

  const formatCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length > 2) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  };

  const copyToClipboard = (value: string, label: string) => {
    Clipboard.setString(value.replace(/\s/g, ''));
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  const handlePay = async () => {
    if (selected === 'cash') { onConfirm('cash', 'pending'); return; }
    if (selected === 'aba' || selected === 'wing') { onConfirm(selected, 'pending'); return; }
    if (selected === 'wallet') {
      if (walletBalance < fare) return;
      await ProfileAPI.deductWallet(fare);
      setSuccess(true);
      setTimeout(() => onConfirm('wallet', 'paid'), 800);
      return;
    }
    if (!cardNumber || !cardName || !expiry || !cvv) return;
    setProcessing(true);
    await new Promise(r => setTimeout(r, 2000));
    setProcessing(false);
    setSuccess(true);
    setTimeout(() => onConfirm('card', 'paid'), 800);
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>✅</Text>
        <Text style={styles.successTitle}>Payment Successful</Text>
        <Text style={styles.successSub}>${fare.toFixed(2)} via {selected}</Text>
      </View>
    );
  }

  const isDisabled =
    processing ||
    (selected === 'card' && (!cardNumber || !cardName || !expiry || !cvv)) ||
    (selected === 'wallet' && walletBalance < fare);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Payment Method</Text>
        <Text style={styles.fareLine}>Total: <Text style={styles.fareAmount}>${fare.toFixed(2)}</Text></Text>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.id}
            onPress={() => setSelected(opt.id)}
            style={[styles.option, selected === opt.id && styles.optionSelected]}
          >
            <Text style={styles.optionIcon}>{opt.icon}</Text>
            <View style={styles.optionInfo}>
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.optionDesc}>{opt.desc}</Text>
            </View>
            <View style={[styles.radio, selected === opt.id && styles.radioSelected]}>
              {selected === opt.id && <View style={styles.radioDot} />}
            </View>
          </TouchableOpacity>
        ))}

        {selected === 'card' && (
          <View style={styles.cardForm}>
            <Text style={styles.demoNote}>Demo only — no real charges</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Card Number (XXXX XXXX XXXX XXXX)"
              placeholderTextColor="#999"
              value={cardNumber}
              onChangeText={v => setCardNumber(formatCardNumber(v))}
              maxLength={19}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.textInput}
              placeholder="Cardholder Name"
              placeholderTextColor="#999"
              value={cardName}
              onChangeText={setCardName}
            />
            <View style={styles.cardRow}>
              <TextInput
                style={[styles.textInput, styles.textInputHalf]}
                placeholder="MM/YY"
                placeholderTextColor="#999"
                value={expiry}
                onChangeText={v => setExpiry(formatExpiry(v))}
                maxLength={5}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.textInput, styles.textInputHalf]}
                placeholder="CVV"
                placeholderTextColor="#999"
                value={cvv}
                onChangeText={v => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                secureTextEntry
                maxLength={4}
                keyboardType="numeric"
              />
            </View>
          </View>
        )}

        {selected === 'aba' && (
          <View style={styles.transferBox}>
            <Text style={styles.transferTitle}>🏦 Pay via ABA</Text>
            <Text style={styles.transferText}>
              Transfer your fare to ABA account{' '}
              <Text style={styles.transferAccount}>{ABA_ACCOUNT}</Text> (Jih).
              Show confirmation to driver.
            </Text>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => copyToClipboard(ABA_ACCOUNT, 'Account number')}
            >
              <Text style={styles.copyBtnText}>Copy account number</Text>
            </TouchableOpacity>
          </View>
        )}

        {selected === 'wing' && (
          <View style={styles.transferBox}>
            <Text style={styles.transferTitle}>📱 Pay via Wing</Text>
            <Text style={styles.transferText}>
              Send your fare to Wing number{' '}
              <Text style={styles.transferAccount}>{WING_NUMBER}</Text> (Jih).
              Show confirmation to driver.
            </Text>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => copyToClipboard(WING_NUMBER, 'Wing number')}
            >
              <Text style={styles.copyBtnText}>Copy Wing number</Text>
            </TouchableOpacity>
          </View>
        )}

        {selected === 'wallet' && (
          <View style={styles.walletBox}>
            <Text style={styles.walletLabel}>Wallet Balance</Text>
            <Text style={[styles.walletBalance, walletBalance < fare && styles.walletInsufficient]}>
              ${walletBalance.toFixed(2)}
            </Text>
            {walletBalance < fare && (
              <Text style={styles.walletError}>Insufficient balance. Top up in your Profile.</Text>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.payBtn, isDisabled && styles.payBtnDisabled]}
          onPress={handlePay}
          disabled={isDisabled}
        >
          {processing ? (
            <ActivityIndicator color="#1A2744" />
          ) : (
            <Text style={styles.payBtnText}>
              {selected === 'cash' ? '🛺 Confirm & Find Driver' : `Pay $${fare.toFixed(2)}`}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  backBtn: { marginBottom: 8 },
  backBtnText: { color: '#666', fontSize: 14 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  fareLine: { fontSize: 14, color: '#666' },
  fareAmount: { fontWeight: '700', fontSize: 18, color: '#000' },
  scroll: { flex: 1, padding: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  optionSelected: { borderColor: '#1A2744', backgroundColor: '#f0f4ff' },
  optionIcon: { fontSize: 24, marginRight: 12 },
  optionInfo: { flex: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: '#000' },
  optionDesc: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: '#1A2744' },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1A2744' },
  cardForm: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 16,
    gap: 10,
  },
  demoNote: {
    fontSize: 12,
    color: '#d97706',
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#000',
  },
  textInputHalf: { flex: 1 },
  cardRow: { flexDirection: 'row', gap: 10 },
  transferBox: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    marginBottom: 16,
    gap: 8,
  },
  transferTitle: { fontSize: 15, fontWeight: '700' },
  transferText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  transferAccount: { fontFamily: 'monospace', fontWeight: '700' },
  copyBtn: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  copyBtnText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  walletBox: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  walletLabel: { fontSize: 14, color: '#6b7280' },
  walletBalance: { fontSize: 20, fontWeight: '700', color: '#16a34a' },
  walletInsufficient: { color: '#dc2626' },
  walletError: { width: '100%', fontSize: 12, color: '#dc2626' },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  payBtn: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { color: '#1A2744', fontSize: 16, fontWeight: '700' },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  successIcon: { fontSize: 64, marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  successSub: { fontSize: 15, color: '#6b7280' },
});
