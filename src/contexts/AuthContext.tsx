import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { ProfileAPI } from '@/lib/api';
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
    fullName: string
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

  const fetchProfile = async (_userId: string) => {
    try {
      const data = await ProfileAPI.get();
      setProfile(data);
    } catch {
      setProfile(null);
    }
  };

  useEffect(() => {
    // Restore existing session on app launch
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  // ── Register ──────────────────────────────────────────────────────────────
  // Registration NEVER signs the user in automatically.  After a successful
  // sign-up we:
  //   1. Create profile + user_roles rows (same tables jihwolrd uses)
  //   2. Sign the user OUT so they must log in manually (jihwolrd behaviour)
  //   3. Return needsVerification=true so the UI can show the email check screen
  const signUp = async (
    email: string,
    password: string,
    fullName: string
  ): Promise<{ error: string | null; needsVerification: boolean }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role: 'passenger' },
      },
    });

    if (error) return { error: error.message, needsVerification: false };

    const newUser = data.user;
    if (!newUser) return { error: 'Could not create account', needsVerification: false };

    // Create profile + user_roles via backend API
    await ProfileAPI.create(fullName, email);

    // If Supabase returned an active session (email confirm disabled), sign out.
    // We always want the user to log in manually, just like on jihwolrd.
    if (data.session) {
      await supabase.auth.signOut();
    }

    // needsVerification is true when the email is not yet confirmed
    const needsVerification = !newUser.email_confirmed_at;
    return { error: null, needsVerification };
  };

  // ── Sign Out ──────────────────────────────────────────────────────────────
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
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
