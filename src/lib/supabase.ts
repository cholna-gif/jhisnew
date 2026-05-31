import { createClient } from '@supabase/supabase-js';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

const memoryStore = new Map<string, string>();
const memoryStorage: AuthStorage = {
  getItem: async (key) => memoryStore.get(key) ?? null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async (key) => {
    memoryStore.delete(key);
  },
};

// In Expo Go, the AsyncStorage native module may be missing or version-mismatched
// relative to the JS package. Supabase Auth needs a working storage adapter for
// session persistence and auto-refresh. Use AsyncStorage when available; fall
// back to an in-memory adapter when it isn't.
const asyncStorageNativeAvailable =
  Platform.OS !== 'web' && NativeModules.RNCAsyncStorage != null;

const safeStorage: AuthStorage = {
  getItem: async (key) => {
    if (!asyncStorageNativeAvailable) return memoryStorage.getItem(key);
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return memoryStorage.getItem(key);
    }
  },
  setItem: async (key, value) => {
    if (!asyncStorageNativeAvailable) return memoryStorage.setItem(key, value);
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      await memoryStorage.setItem(key, value);
    }
  },
  removeItem: async (key) => {
    if (!asyncStorageNativeAvailable) return memoryStorage.removeItem(key);
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      await memoryStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: safeStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
