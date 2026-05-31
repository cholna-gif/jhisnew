import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatKhMask, sanitizeKhDigits, isValidKhPhone, composeKhPhone } from '@/lib/phone';

WebBrowser.maybeCompleteAuthSession();

type Tab = 'signup' | 'login';

const getPasswordStrength = (pw: string): number => {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
};

const STRENGTH_LABEL = ['Very weak', 'Weak', 'Fair', 'Strong'];
const STRENGTH_COLOR = ['#ef4444', '#f97316', '#eab308', '#22c55e'];

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [tab, setTab] = useState<Tab>('signup');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [verificationEmail, setVerificationEmail] = useState('');

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Signup form
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const pwStrength = getPasswordStrength(signupPassword);

  // ─── OAuth ──────────────────────────────────────────────────────────────────
  const handleOAuth = async (provider: 'google' | 'apple') => {
    setOauthLoading(provider);
    try {
      const redirectTo = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (data.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          const url = result.url;
          const params = new URLSearchParams(url.split('#')[1] || url.split('?')[1] || '');
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
      }
    } catch (err: any) {
      Alert.alert('Sign In Failed', err.message || `${provider} sign in failed`);
    } finally {
      setOauthLoading(null);
    }
  };

  // ─── Login ───────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) { Alert.alert('Error', 'Please fill in all fields'); return; }
    setLoading(true);
    const { error } = await signIn(loginEmail.trim(), loginPassword);
    if (error) Alert.alert('Login Failed', error.message || 'Invalid email or password');
    setLoading(false);
  };

  // ─── Sign Up ─────────────────────────────────────────────────────────────────
  const handleSignup = async () => {
    if (!fullName.trim() || !signupEmail.trim() || !signupPassword) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    if (signupPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    if (signupPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (phoneDigits && !isValidKhPhone(phoneDigits)) {
      Alert.alert('Error', 'Please enter a valid Cambodian phone number');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Error', 'Please agree to the Terms of Service');
      return;
    }
    setLoading(true);
    const { error } = await signUp(signupEmail.trim(), signupPassword, fullName.trim());
    if (error) {
      Alert.alert('Sign Up Failed', error.message);
    } else {
      // Save phone if provided
      if (phoneDigits) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('profiles').update({ phone: composeKhPhone(phoneDigits) }).eq('id', user.id);
        }
      }
      setVerificationEmail(signupEmail.trim());
    }
    setLoading(false);
  };

  // ─── Resend verification ──────────────────────────────────────────────────────
  const handleResend = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: verificationEmail });
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Sent', 'Verification email resent!');
    setLoading(false);
  };

  // ─── Verification screen ──────────────────────────────────────────────────────
  if (verificationEmail) {
    return (
      <ImageBackground source={require('@/assets/images/auth-hero.jpg')} style={styles.bg} resizeMode="cover">
        <View style={styles.overlay} />
        <SafeAreaView style={styles.safe}>
          <View style={styles.verifyCard}>
            <View style={styles.mailIcon}>
              <Text style={styles.mailIconText}>✉️</Text>
            </View>
            <Text style={styles.verifyTitle}>Almost there!</Text>
            <Text style={styles.verifyBody}>
              We sent a verification link to{' '}
              <Text style={styles.verifyEmail}>{verificationEmail}</Text>.{'\n'}
              Click the link in your email to activate your account.
            </Text>
            <TouchableOpacity
              style={[styles.outlineBtn, loading && styles.btnDisabled]}
              onPress={handleResend}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#1A2744" size="small" />
                : <Text style={styles.outlineBtnText}>Resend Email</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setVerificationEmail(''); setTab('login'); }}>
              <Text style={styles.linkText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={require('@/assets/images/auth-hero.jpg')} style={styles.bg} resizeMode="cover">
      <View style={styles.overlay} />
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              {/* ── Logo ── */}
              <View style={styles.logoRow}>
                <View style={styles.logoBox}>
                  <Text style={styles.logoEmoji}>🛺</Text>
                </View>
                <Text style={styles.logoName}>jih</Text>
              </View>
              <Text style={styles.cardSubtitle}>Passenger Account</Text>

              {/* ── Google ── */}
              <TouchableOpacity
                style={styles.oauthBtn}
                onPress={() => handleOAuth('google')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'google' ? (
                  <ActivityIndicator size="small" color="#374151" />
                ) : (
                  <GoogleIcon />
                )}
                <Text style={styles.oauthBtnText}>Continue with Google</Text>
              </TouchableOpacity>

              {/* ── Apple ── */}
              <TouchableOpacity
                style={[styles.oauthBtn, styles.oauthBtnApple]}
                onPress={() => handleOAuth('apple')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'apple' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.appleIcon}></Text>
                )}
                <Text style={[styles.oauthBtnText, styles.oauthBtnTextApple]}>Continue with Apple</Text>
              </TouchableOpacity>

              {/* ── Divider ── */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with email</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* ── Tabs ── */}
              <View style={styles.tabs}>
                <TouchableOpacity
                  style={[styles.tabBtn, tab === 'signup' && styles.tabBtnActive]}
                  onPress={() => setTab('signup')}
                >
                  <Text style={[styles.tabBtnText, tab === 'signup' && styles.tabBtnTextActive]}>
                    Sign Up
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabBtn, tab === 'login' && styles.tabBtnActive]}
                  onPress={() => setTab('login')}
                >
                  <Text style={[styles.tabBtnText, tab === 'login' && styles.tabBtnTextActive]}>
                    Log In
                  </Text>
                </TouchableOpacity>
              </View>

              {/* ── Login form ── */}
              {tab === 'login' && (
                <View style={styles.form}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#9ca3af"
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                  <PasswordField
                    placeholder="Password"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    show={showLoginPw}
                    onToggle={() => setShowLoginPw(v => !v)}
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtn, loading && styles.btnDisabled]}
                    onPress={handleLogin}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#1A2744" size="small" />
                      : <Text style={styles.primaryBtnText}>Log In</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => Alert.alert('Reset Password', 'Enter your email and we will send you a reset link.\n\nFor now, use the web app at jih.app to reset your password.')}>
                    <Text style={[styles.linkText, { textAlign: 'center' }]}>Forgot password?</Text>
                  </TouchableOpacity>
                  <Text style={styles.switchText}>
                    Don't have an account?{' '}
                    <Text style={styles.switchLink} onPress={() => setTab('signup')}>Sign Up</Text>
                  </Text>
                </View>
              )}

              {/* ── Sign Up form ── */}
              {tab === 'signup' && (
                <View style={styles.form}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor="#9ca3af"
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#9ca3af"
                    value={signupEmail}
                    onChangeText={setSignupEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                  />

                  {/* +855 Phone */}
                  <View style={styles.phoneRow}>
                    <View style={styles.phonePrefix}>
                      <Text style={styles.phonePrefixText}>+855</Text>
                    </View>
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="XX XXX XXXX (optional)"
                      placeholderTextColor="#9ca3af"
                      value={formatKhMask(phoneDigits)}
                      onChangeText={v => setPhoneDigits(sanitizeKhDigits(v))}
                      keyboardType="phone-pad"
                      maxLength={12}
                    />
                  </View>
                  {phoneDigits.length > 0 && !isValidKhPhone(phoneDigits) && (
                    <Text style={styles.fieldError}>Please enter a valid Cambodian phone number</Text>
                  )}

                  {/* Password */}
                  <PasswordField
                    placeholder="Password (min. 8 characters)"
                    value={signupPassword}
                    onChange={setSignupPassword}
                    show={showSignupPw}
                    onToggle={() => setShowSignupPw(v => !v)}
                  />
                  {signupPassword.length > 0 && (
                    <View style={styles.strengthContainer}>
                      <View style={styles.strengthBar}>
                        <View
                          style={[
                            styles.strengthFill,
                            {
                              width: `${pwStrength * 25}%` as any,
                              backgroundColor: STRENGTH_COLOR[pwStrength] || '#e5e7eb',
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.strengthLabel, { color: STRENGTH_COLOR[pwStrength] || '#9ca3af' }]}>
                        {STRENGTH_LABEL[pwStrength]}
                      </Text>
                    </View>
                  )}

                  {/* Confirm Password */}
                  <PasswordField
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    show={showConfirmPw}
                    onToggle={() => setShowConfirmPw(v => !v)}
                  />
                  {confirmPassword.length > 0 && signupPassword !== confirmPassword && (
                    <Text style={styles.fieldError}>Passwords do not match</Text>
                  )}

                  {/* Terms */}
                  <TouchableOpacity
                    style={styles.termsRow}
                    onPress={() => setAgreedToTerms(v => !v)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                      {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.termsText}>
                      I agree to the{' '}
                      <Text style={styles.termsLink}>Terms of Service</Text>
                      {' '}and{' '}
                      <Text style={styles.termsLink}>Privacy Policy</Text>
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primaryBtn, (!agreedToTerms || loading) && styles.btnDisabled]}
                    onPress={handleSignup}
                    disabled={!agreedToTerms || loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#1A2744" size="small" />
                      : <Text style={styles.primaryBtnText}>Create Account</Text>
                    }
                  </TouchableOpacity>
                  <Text style={styles.switchText}>
                    Already have an account?{' '}
                    <Text style={styles.switchLink} onPress={() => setTab('login')}>Log In</Text>
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PasswordField({
  placeholder,
  value,
  onChange,
  show,
  onToggle,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.pwRow}>
      <TextInput
        style={[styles.input, styles.pwInput]}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        value={value}
        onChangeText={onChange}
        secureTextEntry={!show}
        autoComplete="password"
      />
      <TouchableOpacity style={styles.eyeBtn} onPress={onToggle}>
        <Text style={styles.eyeIcon}>{show ? '🙈' : '👁️'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function GoogleIcon() {
  // Google 'G' rendered with brand colours matching the SVG in jihwolrd
  return (
    <View style={gStyles.circle}>
      <Text style={gStyles.b}>G</Text>
    </View>
  );
}

const gStyles = StyleSheet.create({
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  b: { fontSize: 12, fontWeight: '700', color: '#4285F4', lineHeight: 16 },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,39,68,0.65)' },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },

  // Verify screen
  verifyCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  mailIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  mailIconText: { fontSize: 36 },
  verifyTitle: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  verifyBody: { fontSize: 15, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  verifyEmail: { fontWeight: '700', color: '#D4AF37' },
  outlineBtn: {
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: '#fff',
    width: '100%',
    maxWidth: 380,
  },
  outlineBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0px 20px 40px rgba(0,0,0,0.4)',
  },

  // Logo
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1A2744',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: { fontSize: 24 },
  logoName: { fontSize: 28, fontWeight: '800', color: '#1A2744', letterSpacing: 1 },
  cardSubtitle: { textAlign: 'center', fontSize: 15, color: '#6b7280', marginBottom: 20, marginTop: 2 },

  // OAuth buttons
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 13,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  oauthBtnApple: { backgroundColor: '#111', borderColor: '#111', marginBottom: 0 },
  oauthBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  oauthBtnTextApple: { color: '#fff' },
  appleIcon: { fontSize: 18, color: '#fff', lineHeight: 20 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerText: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Tabs
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#fff', boxShadow: '0px 1px 3px rgba(0,0,0,0.1)' } as any,
  tabBtnText: { fontSize: 14, fontWeight: '500', color: '#9ca3af' },
  tabBtnTextActive: { color: '#1A2744', fontWeight: '700' },

  // Form
  form: { gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fff',
  },

  // Phone
  phoneRow: { flexDirection: 'row', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden' },
  phonePrefix: { paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#f3f4f6', borderRightWidth: 1, borderRightColor: '#e5e7eb' },
  phonePrefixText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  phoneInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: '#111', backgroundColor: '#fff' },

  // Password field
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  pwInput: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 },
  eyeBtn: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderLeftWidth: 0,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
    backgroundColor: '#fff',
  },
  eyeIcon: { fontSize: 16 },

  // Strength
  strengthContainer: { gap: 4, marginTop: -4 },
  strengthBar: { height: 5, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: 3 },
  strengthLabel: { fontSize: 11, fontWeight: '500' },

  // Terms
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#d1d5db', marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#1A2744', borderColor: '#1A2744' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  termsText: { flex: 1, fontSize: 13, color: '#6b7280', lineHeight: 19 },
  termsLink: { color: '#1A2744', fontWeight: '600' },

  // Buttons
  primaryBtn: {
    backgroundColor: '#1A2744',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Links
  linkText: { color: '#1A2744', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  switchText: { textAlign: 'center', fontSize: 13, color: '#6b7280' },
  switchLink: { color: '#1A2744', fontWeight: '600' },

  // Error
  fieldError: { fontSize: 11, color: '#ef4444', marginTop: -6 },
});
