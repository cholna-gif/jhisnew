import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AuthAPI, ProfileAPI } from '@/lib/api';
import { Profile } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ) => Promise<{ error: string | null; needsVerification: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (user: import('@supabase/supabase-js').User) => {
    try {
      const data = await ProfileAPI.get();
      setProfile(data);
    } catch {
      // First-time Google/OAuth sign-in — profile row doesn't exist yet, create it
      try {
        const fullName = String(
          user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
        );
        const email = user.email ?? '';
        if (email) {
          await ProfileAPI.create(fullName || email.split('@')[0], email);
          const data = await ProfileAPI.get();
          setProfile(data);
        }
      } catch {
        setProfile(null);
      }
    }
  };

  useEffect(() => {
    // Restore existing session on app launch
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      return { error: 'Please verify your email before logging in.' };
    }
    return { error: null };
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    phone?: string
  ): Promise<{ error: string | null; needsVerification: boolean }> => {
    try {
      const result = await AuthAPI.signUp(fullName, email, password, phone);
      return { error: null, needsVerification: result.needsVerification };
    } catch (err: any) {
      return { error: err.message ?? 'Could not create account', needsVerification: false };
    }
  };

  // ── Sign Out ──────────────────────────────────────────────────────────────
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user);
  };

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
