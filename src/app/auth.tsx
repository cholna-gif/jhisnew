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
import { ProfileAPI } from '@/lib/api';
import { formatKhMask, sanitizeKhDigits, isValidKhPhone, composeKhPhone } from '@/lib/phone';

WebBrowser.maybeCompleteAuthSession();

type Tab = 'login' | 'signup';

// ── Password strength ─────────────────────────────────────────────────────────
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

// ── Component ────────────────────────────────────────────────────────────────
export default function AuthScreen() {
  const { signIn, signUp } = useAuth();

  const [tab, setTab] = useState<Tab>('login');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);

  // Verification screen shown after successful sign-up
  const [verificationEmail, setVerificationEmail] = useState('');

  // ── Login fields ─────────────────────────────────────────────────────────
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  // ── Sign-up fields ────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const pwStrength = getPasswordStrength(signupPassword);

  // ── Google / Apple OAuth ─────────────────────────────────────────────────
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
          const fragment = result.url.split('#')[1] ?? result.url.split('?')[1] ?? '';
          const params = new URLSearchParams(fragment);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
          }
        }
      }
    } catch (err: any) {
      Alert.alert(`${provider === 'google' ? 'Google' : 'Apple'} Sign In Failed`, err.message ?? 'Please try again');
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Login ────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await signIn(loginEmail.trim().toLowerCase(), loginPassword);
    setLoading(false);
    if (error) {
      Alert.alert('Login Failed', error);
    }
    // On success AuthContext.session will be set → AppNavigator re-renders → shows (tabs)
  };

  // ── Register ──────────────────────────────────────────────────────────────
  const handleSignup = async () => {
    if (!fullName.trim() || !signupEmail.trim() || !signupPassword) {
      Alert.alert('Missing fields', 'Full name, email and password are required.');
      return;
    }
    if (signupPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please re-enter your password.');
      return;
    }
    if (phoneDigits.length > 0 && !isValidKhPhone(phoneDigits)) {
      Alert.alert('Invalid phone', 'Please enter a valid Cambodian phone number.');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Terms required', 'Please agree to the Terms of Service.');
      return;
    }

    setLoading(true);
    const { error, needsVerification } = await signUp(
      signupEmail.trim().toLowerCase(),
      signupPassword,
      fullName.trim()
    );
    setLoading(false);

    if (error) {
      Alert.alert('Sign Up Failed', error);
      return;
    }

    // Save phone number via backend API
    if (phoneDigits.length > 0) {
      try {
        await ProfileAPI.update({ phone: composeKhPhone(phoneDigits) });
      } catch {}
    }

    if (needsVerification) {
      // Show the "check your email" screen
      setVerificationEmail(signupEmail.trim().toLowerCase());
    } else {
      // Email confirmation is disabled on this project — account ready, ask to log in
      Alert.alert(
        'Account Created!',
        'Your account is ready. Please log in with your email and password.',
        [{ text: 'Go to Login', onPress: () => setTab('login') }]
      );
    }
  };

  // ── Resend verification email ─────────────────────────────────────────────
  const handleResend = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: verificationEmail });
    setLoading(false);
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Sent!', 'Verification email resent. Check your inbox.');
  };

  // ── Verification screen ───────────────────────────────────────────────────
  if (verificationEmail) {
    return (
      <ImageBackground
        source={require('@/assets/images/auth-hero.jpg')}
        style={styles.bg}
        resizeMode="cover"
      >
        <View style={styles.overlay} />
        <SafeAreaView style={styles.safe}>
          <View style={styles.verifyWrap}>
            <View style={styles.mailIconBox}>
              <Text style={styles.mailEmoji}>✉️</Text>
            </View>
            <Text style={styles.verifyTitle}>Almost there!</Text>
            <Text style={styles.verifyBody}>
              We sent a verification link to{'\n'}
              <Text style={styles.verifyEmail}>{verificationEmail}</Text>
              {'\n\n'}Click the link to activate your account, then come back and log in.
            </Text>
            <TouchableOpacity
              style={[styles.outlineBtn, loading && styles.disabled]}
              onPress={handleResend}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#374151" size="small" />
                : <Text style={styles.outlineBtnText}>Resend Email</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setVerificationEmail(''); setTab('login'); }}
            >
              <Text style={styles.link}>← Back to Login</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    );
  }

  // ── Main auth card ────────────────────────────────────────────────────────
  return (
    <ImageBackground
      source={require('@/assets/images/auth-hero.jpg')}
      style={styles.bg}
      resizeMode="cover"
    >
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

              {/* ─ Logo ─ */}
              <View style={styles.logoRow}>
                <View style={styles.logoBox}>
                  <Text style={styles.logoEmoji}>🛺</Text>
                </View>
                <Text style={styles.logoName}>jih</Text>
              </View>
              <Text style={styles.subtitle}>Passenger Account</Text>

              {/* ─ Google ─ */}
              <TouchableOpacity
                style={styles.oauthBtn}
                onPress={() => handleOAuth('google')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'google'
                  ? <ActivityIndicator size="small" color="#374151" />
                  : <GoogleIcon />
                }
                <Text style={styles.oauthBtnText}>Continue with Google</Text>
              </TouchableOpacity>

              {/* ─ Apple ─ */}
              <TouchableOpacity
                style={[styles.oauthBtn, styles.appleBtn]}
                onPress={() => handleOAuth('apple')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'apple'
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.appleIcon}></Text>
                }
                <Text style={[styles.oauthBtnText, { color: '#fff' }]}>Continue with Apple</Text>
              </TouchableOpacity>

              {/* ─ Divider ─ */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or continue with email</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* ─ Tab switcher ─ */}
              <View style={styles.tabs}>
                {(['login', 'signup'] as Tab[]).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
                    onPress={() => setTab(t)}
                  >
                    <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                      {t === 'login' ? 'Log In' : 'Sign Up'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ════════════ LOGIN ════════════ */}
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
                    returnKeyType="next"
                  />

                  <PwField
                    placeholder="Password"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    show={showLoginPw}
                    toggle={() => setShowLoginPw(v => !v)}
                    returnKeyType="done"
                    onSubmit={handleLogin}
                  />

                  <TouchableOpacity
                    style={[styles.primaryBtn, loading && styles.disabled]}
                    onPress={handleLogin}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#1A2744" size="small" />
                      : <Text style={styles.primaryBtnText}>Log In →</Text>
                    }
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert(
                        'Reset Password',
                        'Open the Jih web app to reset your password, then log in here.',
                        [{ text: 'OK' }]
                      )
                    }
                  >
                    <Text style={[styles.link, { textAlign: 'center' }]}>Forgot password?</Text>
                  </TouchableOpacity>

                  <Text style={styles.switchText}>
                    No account?{' '}
                    <Text style={styles.switchLink} onPress={() => setTab('signup')}>Sign Up</Text>
                  </Text>
                </View>
              )}

              {/* ════════════ SIGN UP ════════════ */}
              {tab === 'signup' && (
                <View style={styles.form}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor="#9ca3af"
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                    returnKeyType="next"
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
                    returnKeyType="next"
                  />

                  {/* +855 phone */}
                  <View style={styles.phoneRow}>
                    <View style={styles.phonePrefixBox}>
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
                    <Text style={styles.fieldError}>Please enter a valid Cambodian phone number.</Text>
                  )}

                  <PwField
                    placeholder="Password (min. 8 characters)"
                    value={signupPassword}
                    onChange={setSignupPassword}
                    show={showSignupPw}
                    toggle={() => setShowSignupPw(v => !v)}
                  />
                  {signupPassword.length > 0 && (
                    <View style={styles.strengthWrap}>
                      <View style={styles.strengthBg}>
                        <View
                          style={[
                            styles.strengthFill,
                            {
                              width: `${pwStrength * 25}%` as any,
                              backgroundColor: STRENGTH_COLOR[pwStrength],
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.strengthLabel, { color: STRENGTH_COLOR[pwStrength] }]}>
                        {STRENGTH_LABEL[pwStrength]}
                      </Text>
                    </View>
                  )}

                  <PwField
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    show={showConfirmPw}
                    toggle={() => setShowConfirmPw(v => !v)}
                  />
                  {confirmPassword.length > 0 && signupPassword !== confirmPassword && (
                    <Text style={styles.fieldError}>Passwords do not match.</Text>
                  )}

                  {/* Terms checkbox */}
                  <TouchableOpacity
                    style={styles.termsRow}
                    onPress={() => setAgreedToTerms(v => !v)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, agreedToTerms && styles.checkboxOn]}>
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
                    style={[styles.primaryBtn, (!agreedToTerms || loading) && styles.disabled]}
                    onPress={handleSignup}
                    disabled={!agreedToTerms || loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#1A2744" size="small" />
                      : <Text style={styles.primaryBtnText}>Create Account →</Text>
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

function PwField({
  placeholder, value, onChange, show, toggle, returnKeyType, onSubmit,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggle: () => void;
  returnKeyType?: 'done' | 'next';
  onSubmit?: () => void;
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
        returnKeyType={returnKeyType ?? 'done'}
        onSubmitEditing={onSubmit}
      />
      <TouchableOpacity style={styles.eyeBtn} onPress={toggle}>
        <Text style={styles.eyeIcon}>{show ? '🙈' : '👁️'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function GoogleIcon() {
  return (
    <View style={gS.wrap}>
      <Text style={gS.g}>G</Text>
    </View>
  );
}
const gS = StyleSheet.create({
  wrap: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  g: { fontSize: 12, fontWeight: '700', color: '#4285F4', lineHeight: 16 },
});

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(26,39,68,0.65)' },
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 24 },

  // ── verification ──
  verifyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  mailIconBox: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  mailEmoji: { fontSize: 36 },
  verifyTitle: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  verifyBody: { fontSize: 15, color: 'rgba(255,255,255,0.85)', textAlign: 'center', lineHeight: 23, marginBottom: 24 },
  verifyEmail: { fontWeight: '700', color: '#D4AF37' },
  outlineBtn: { borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center', marginBottom: 16, backgroundColor: '#fff', width: '100%', maxWidth: 380 },
  outlineBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },

  // ── card ──
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 440 },

  // ── logo ──
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 },
  logoBox: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#1A2744', alignItems: 'center', justifyContent: 'center' },
  logoEmoji: { fontSize: 24 },
  logoName: { fontSize: 28, fontWeight: '800', color: '#1A2744', letterSpacing: 1 },
  subtitle: { textAlign: 'center', fontSize: 14, color: '#6b7280', marginBottom: 20, marginTop: 2 },

  // ── oauth ──
  oauthBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 13, marginBottom: 8, backgroundColor: '#fff' },
  appleBtn: { backgroundColor: '#111', borderColor: '#111', marginBottom: 0 },
  oauthBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  appleIcon: { fontSize: 18, color: '#fff', lineHeight: 20 },

  // ── divider ──
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerText: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },

  // ── tabs ──
  tabs: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#fff' },
  tabBtnText: { fontSize: 14, fontWeight: '500', color: '#9ca3af' },
  tabBtnTextActive: { color: '#1A2744', fontWeight: '700' },

  // ── form ──
  form: { gap: 12 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: '#111', backgroundColor: '#fff' },

  // ── phone ──
  phoneRow: { flexDirection: 'row', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden' },
  phonePrefixBox: { paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#f3f4f6', borderRightWidth: 1, borderRightColor: '#e5e7eb' },
  phonePrefixText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  phoneInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: '#111', backgroundColor: '#fff' },

  // ── password field ──
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  pwInput: { flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRightWidth: 0 },
  eyeBtn: { borderWidth: 1, borderColor: '#e5e7eb', borderLeftWidth: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: '#fff' },
  eyeIcon: { fontSize: 16 },

  // ── strength ──
  strengthWrap: { gap: 4, marginTop: -4 },
  strengthBg: { height: 5, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: 3 },
  strengthLabel: { fontSize: 11, fontWeight: '500' },

  // ── terms ──
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#d1d5db', marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#1A2744', borderColor: '#1A2744' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  termsText: { flex: 1, fontSize: 13, color: '#6b7280', lineHeight: 20 },
  termsLink: { color: '#1A2744', fontWeight: '600' },

  // ── buttons ──
  primaryBtn: { backgroundColor: '#1A2744', borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  disabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── misc ──
  link: { color: '#1A2744', fontSize: 13, fontWeight: '600' },
  switchText: { textAlign: 'center', fontSize: 13, color: '#6b7280' },
  switchLink: { color: '#1A2744', fontWeight: '600' },
  fieldError: { fontSize: 11, color: '#ef4444', marginTop: -4 },
});
