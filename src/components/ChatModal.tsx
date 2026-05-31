import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { supabase } from '@/lib/supabase';

interface Message {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'passenger' | 'driver';
  message: string;
  created_at: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  passengerId: string;
  driverName: string;
}

export default function ChatModal({ visible, onClose, rideId, passengerId, driverName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const listRef = useRef<FlatList>(null);

  // ── Load history + subscribe to new messages ──────────────────────────────
  useEffect(() => {
    if (!visible || !rideId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('chat_messages' as any)
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true }) as any;
      if (!cancelled) {
        setMessages((data as Message[]) ?? []);
        setLoading(false);
      }
    };
    load();

    const channel = supabase
      .channel(`chat-${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [visible, rideId]);

  // ── Scroll to bottom on new messages ──────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');

    await supabase.from('chat_messages' as any).insert({
      ride_id:     rideId,
      sender_id:   passengerId,
      sender_role: 'passenger',
      message:     text,
    } as any);

    setSending(false);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_role === 'passenger';
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{driverName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.message}</Text>
          <Text style={[styles.bubbleTime, isMe && { color: 'rgba(255,255,255,0.6)' }]}>
            {new Date(item.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarTxt}>{driverName.charAt(0).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.headerName}>{driverName || 'Driver'}</Text>
              <Text style={styles.headerSub}>Your driver</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <SymbolView name="xmark.circle.fill" style={{ width: 28, height: 28 }} tintColor="#9ca3af" resizeMode="scaleAspectFit" />
          </TouchableOpacity>
        </View>

        {/* ── Messages ── */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#1A2744" size="large" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.empty}>
                <SymbolView name="bubble.left.and.bubble.right" style={{ width: 40, height: 40 }} tintColor="#d1d5db" resizeMode="scaleAspectFit" />
                <Text style={styles.emptyText}>No messages yet{'\n'}Say hi to your driver!</Text>
              </View>
            }
            renderItem={renderMessage}
          />
        )}

        {/* ── Input ── */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Type a message…"
              placeholderTextColor="#9ca3af"
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <SymbolView name="paperplane.fill" style={{ width: 18, height: 18 }} tintColor="#fff" resizeMode="scaleAspectFit" />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  headerAvatarTxt: { color: '#D4AF37', fontWeight: '700', fontSize: 18 },
  headerName: { fontSize: 16, fontWeight: '700', color: '#111' },
  headerSub: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  closeBtn: { padding: 4 },

  // ── List ──
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 21 },

  // ── Bubbles ──
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowThem: { justifyContent: 'flex-start' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarTxt: { color: '#D4AF37', fontWeight: '700', fontSize: 12 },
  bubble: { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMe: { backgroundColor: '#1A2744', borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#f3f4f6', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, color: '#111', lineHeight: 20 },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: '#9ca3af', marginTop: 3, textAlign: 'right' },

  // ── Input ──
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
    maxHeight: 100,
    backgroundColor: '#f9fafb',
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#1A2744',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
