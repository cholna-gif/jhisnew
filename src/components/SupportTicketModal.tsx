import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { supabase } from '@/lib/supabase';

const CATEGORIES = [
  { id: 'booking',  label: 'Booking Issue',     symbol: 'car.fill'              },
  { id: 'payment',  label: 'Payment',            symbol: 'creditcard.fill'       },
  { id: 'driver',   label: 'Driver Complaint',   symbol: 'person.fill.xmark'     },
  { id: 'account',  label: 'Account',            symbol: 'person.crop.circle'    },
  { id: 'bug',      label: 'App Bug',            symbol: 'ant.fill'              },
  { id: 'other',    label: 'Other',              symbol: 'ellipsis.circle.fill'  },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  userEmail?: string;
}

type SubmitState = 'idle' | 'loading' | 'success' | 'error';

export default function SupportTicketModal({ visible, onClose, userId, userEmail }: Props) {
  const [category, setCategory] = useState<Category>('booking');
  const [message,  setMessage]  = useState('');
  const [state,    setState]    = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => {
    setCategory('booking');
    setMessage('');
    setState('idle');
    setErrorMsg('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (message.trim().length < 10) {
      setErrorMsg('Please describe your issue in at least 10 characters.');
      return;
    }
    setState('loading');
    setErrorMsg('');

    const selectedLabel = CATEGORIES.find(c => c.id === category)?.label ?? category;

    const { error } = await supabase.from('support_tickets' as any).insert({
      user_id:  userId,
      subject:  selectedLabel,
      category: selectedLabel,
      message:  message.trim(),
      status:   'open',
    } as any);

    if (error) {
      setErrorMsg(error.message || 'Failed to send ticket. Please try again.');
      setState('error');
    } else {
      setState('success');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>

          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Support Ticket</Text>
              <Text style={styles.subtitle}>We'll reply to you as soon as possible</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <SymbolView name="xmark.circle.fill" style={{ width: 26, height: 26 }} tintColor="#9ca3af" resizeMode="scaleAspectFit" />
            </TouchableOpacity>
          </View>

          {/* ── Success ── */}
          {state === 'success' ? (
            <View style={styles.successWrap}>
              <View style={styles.successIcon}>
                <SymbolView name="checkmark.circle.fill" style={{ width: 56, height: 56 }} tintColor="#22c55e" resizeMode="scaleAspectFit" />
              </View>
              <Text style={styles.successTitle}>Ticket Sent!</Text>
              <Text style={styles.successBody}>
                Your support ticket has been submitted.{'\n'}Our team will get back to you soon.
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

              {/* ── Category ── */}
              <Text style={styles.label}>Category</Text>
              <View style={styles.categoryGrid}>
                {CATEGORIES.map(cat => {
                  const active = category === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.catChip, active && styles.catChipActive]}
                      onPress={() => setCategory(cat.id)}
                      activeOpacity={0.7}
                    >
                      <SymbolView
                        name={cat.symbol as any}
                        style={{ width: 16, height: 16 }}
                        tintColor={active ? '#1A2744' : '#6b7280'}
                        resizeMode="scaleAspectFit"
                      />
                      <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Message ── */}
              <Text style={[styles.label, { marginTop: 20 }]}>Describe your issue</Text>
              <TextInput
                style={styles.messageInput}
                placeholder="Tell us what happened, include as much detail as possible…"
                placeholderTextColor="#9ca3af"
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
                maxLength={1000}
              />
              <Text style={styles.charCount}>{message.length} / 1000</Text>

              {/* ── Error ── */}
              {errorMsg.length > 0 && (
                <View style={styles.errorBox}>
                  <SymbolView name="exclamationmark.triangle.fill" style={{ width: 16, height: 16 }} tintColor="#dc2626" resizeMode="scaleAspectFit" />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}

              {/* ── Submit ── */}
              <TouchableOpacity
                style={[styles.submitBtn, state === 'loading' && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={state === 'loading'}
              >
                {state === 'loading' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <SymbolView name="paperplane.fill" style={{ width: 16, height: 16 }} tintColor="#fff" resizeMode="scaleAspectFit" />
                    <Text style={styles.submitBtnText}>Send Ticket</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.footer}>
                Ticket ID and status will be sent to{' '}
                <Text style={{ fontWeight: '600' }}>{userEmail || 'your registered email'}</Text>
              </Text>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  closeBtn: {
    padding: 4,
    marginTop: 2,
  },

  // ── Form ──
  form: {
    padding: 20,
    paddingBottom: 48,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Category chips ──
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  catChipActive: {
    borderColor: '#D4AF37',
    backgroundColor: '#D4AF37',
  },
  catChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  catChipTextActive: {
    color: '#1A2744',
    fontWeight: '700',
  },

  // ── Message ──
  messageInput: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#f9fafb',
    minHeight: 140,
    lineHeight: 20,
  },
  charCount: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 4,
  },

  // ── Error ──
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#dc2626',
  },

  // ── Submit ──
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A2744',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 20,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  footer: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },

  // ── Success ──
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successIcon: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
    marginBottom: 10,
  },
  successBody: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  doneBtn: {
    backgroundColor: '#1A2744',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  doneBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
