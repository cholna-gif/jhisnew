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

const C = {
  navy:       '#0D1B36',
  navyLight:  '#1A2744',
  gold:       '#D4AF37',
  goldDim:    'rgba(212,175,55,0.18)',
  white:      '#ffffff',
  white60:    'rgba(255,255,255,0.60)',
  white35:    'rgba(255,255,255,0.35)',
  white12:    'rgba(255,255,255,0.12)',
  white08:    'rgba(255,255,255,0.08)',
  white18:    'rgba(255,255,255,0.18)',
  inputBg:    'rgba(255,255,255,0.07)',
  inputBorder:'rgba(255,255,255,0.16)',
  red:        '#ef4444',

};

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

  const [tab, setTab] = useState<Tab>('login');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [verificationEmail, setVerificationEmail] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const pwStrength = getPasswordStrength(signupPassword);

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
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          }
        }
      }
    } catch (err: any) {
      Alert.alert(`${provider === 'google' ? 'Google' : 'Apple'} Sign In Failed`, err.message ?? 'Please try again');
    } finally {
      setOauthLoading(null);
    }
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await signIn(loginEmail.trim().toLowerCase(), loginPassword);
    setLoading(false);
    if (error) Alert.alert('Login Failed', error);
  };

  const handleSignup = async () => {
    if (!fullName.trim() || !signupEmail.trim() || !signupPassword) {
      Alert.alert('Missing fields', 'Full name, email and password are required.');
      return;
    }
    if (signupPassword.length < 8) { Alert.alert('Weak password', 'Password must be at least 8 characters.'); return; }
    if (signupPassword !== confirmPassword) { Alert.alert('Passwords do not match', 'Please re-enter your password.'); return; }
    if (phoneDigits.length > 0 && !isValidKhPhone(phoneDigits)) { Alert.alert('Invalid phone', 'Please enter a valid Cambodian phone number.'); return; }
    if (!agreedToTerms) { Alert.alert('Terms required', 'Please agree to the Terms of Service.'); return; }

    setLoading(true);
    const { error, needsVerification } = await signUp(signupEmail.trim().toLowerCase(), signupPassword, fullName.trim());
    setLoading(false);

    if (error) { Alert.alert('Sign Up Failed', error); return; }

    if (phoneDigits.length > 0) {
      try { await ProfileAPI.update({ phone: composeKhPhone(phoneDigits) }); } catch {}
    }

    if (needsVerification) {
      setVerificationEmail(signupEmail.trim().toLowerCase());
    } else {
      Alert.alert('Account Created!', 'Your account is ready. Please log in.', [{ text: 'Go to Login', onPress: () => setTab('login') }]);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: verificationEmail });
    setLoading(false);
    if (error) Alert.alert('Error', error.message);
    else Alert.alert('Sent!', 'Verification email resent. Check your inbox.');
  };

  // ── Verification screen ──────────────────────────────────────────────────
  if (verificationEmail) {
    return (
      <View style={s.bg}>
        <SafeAreaView style={s.safe}>
          <View style={s.verifyWrap}>
            <View style={s.verifyIconRing}>
              <View style={s.verifyIconInner}>
                <Text style={s.verifyEmoji}>✉️</Text>
              </View>
            </View>
            <Text style={s.verifyTitle}>Check your inbox</Text>
            <Text style={s.verifyBody}>
              We sent a verification link to{'\n'}
              <Text style={s.verifyHighlight}>{verificationEmail}</Text>
              {'\n\n'}Tap the link to activate your account, then come back and log in.
            </Text>
            <TouchableOpacity style={[s.goldBtn, loading && s.disabled]} onPress={handleResend} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.navy} size="small" />
                : <Text style={s.goldBtnText}>Resend Email</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.ghostBtn} onPress={() => { setVerificationEmail(''); setTab('login'); }}>
              <Text style={s.ghostBtnText}>← Back to Login</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Main screen ──────────────────────────────────────────────────────────
  return (
    <View style={s.bg}>
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

            {/* ── Hero / Branding ── */}
            <View style={s.hero}>
              <View style={s.logoRing}>
                <View style={s.logoInner}>
                  <Text style={s.logoEmoji}>🛺</Text>
                </View>
              </View>
              <Text style={s.appName}>jih</Text>
              <Text style={s.tagline}>Cambodia's community ride</Text>
            </View>

            {/* ── Social Login ── */}
            <View style={s.socialRow}>
              <TouchableOpacity
                style={s.socialBtn}
                onPress={() => handleOAuth('google')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'google'
                  ? <ActivityIndicator size="small" color={C.white} />
                  : <>
                      <View style={s.gIconWrap}><Text style={s.gIconText}>G</Text></View>
                      <Text style={s.socialBtnText}>Google</Text>
                    </>
                }
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.socialBtn, s.appleSocialBtn]}
                onPress={() => handleOAuth('apple')}
                disabled={!!oauthLoading}
              >
                {oauthLoading === 'apple'
                  ? <ActivityIndicator size="small" color={C.white} />
                  : <>
                      <Text style={s.appleIconText}></Text>
                      <Text style={s.socialBtnText}>Apple</Text>
                    </>
                }
              </TouchableOpacity>
            </View>

            {/* ── Divider ── */}
            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>or use email</Text>
              <View style={s.dividerLine} />
            </View>

            {/* ── Tab switcher ── */}
            <View style={s.tabBar}>
              {(['login', 'signup'] as Tab[]).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.tabBtn, tab === t && s.tabBtnActive]}
                  onPress={() => setTab(t)}
                >
                  <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive]}>
                    {t === 'login' ? 'Log In' : 'Sign Up'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ════ LOGIN ════ */}
            {tab === 'login' && (
              <View style={s.form}>
                <GlassInput
                  placeholder="Email address"
                  value={loginEmail}
                  onChangeText={setLoginEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="next"
                  icon="✉"
                />
                <GlassPwField
                  placeholder="Password"
                  value={loginPassword}
                  onChange={setLoginPassword}
                  show={showLoginPw}
                  toggle={() => setShowLoginPw(v => !v)}
                  returnKeyType="done"
                  onSubmit={handleLogin}
                />

                <TouchableOpacity
                  style={[s.goldBtn, loading && s.disabled]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={C.navy} size="small" />
                    : <Text style={s.goldBtnText}>Log In →</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.forgotWrap}
                  onPress={() => Alert.alert('Reset Password', 'Open the Jih web app to reset your password, then log in here.')}
                >
                  <Text style={s.forgotText}>Forgot password?</Text>
                </TouchableOpacity>

                <Text style={s.switchText}>
                  No account?{'  '}
                  <Text style={s.switchLink} onPress={() => setTab('signup')}>Sign Up</Text>
                </Text>
              </View>
            )}

            {/* ════ SIGN UP ════ */}
            {tab === 'signup' && (
              <View style={s.form}>
                <GlassInput
                  placeholder="Full name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  returnKeyType="next"
                  icon="👤"
                />
                <GlassInput
                  placeholder="Email address"
                  value={signupEmail}
                  onChangeText={setSignupEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="next"
                  icon="✉"
                />

                {/* Phone */}
                <View style={s.phoneRow}>
                  <View style={s.phonePrefixWrap}>
                    <Text style={s.phoneFlag}>🇰🇭</Text>
                    <Text style={s.phonePrefix}>+855</Text>
                  </View>
                  <TextInput
                    style={s.phoneInput}
                    placeholder="XX XXX XXXX (optional)"
                    placeholderTextColor={C.white35}
                    value={formatKhMask(phoneDigits)}
                    onChangeText={v => setPhoneDigits(sanitizeKhDigits(v))}
                    keyboardType="phone-pad"
                    maxLength={12}
                  />
                </View>
                {phoneDigits.length > 0 && !isValidKhPhone(phoneDigits) && (
                  <Text style={s.fieldError}>⚠ Invalid Cambodian phone number</Text>
                )}

                <GlassPwField
                  placeholder="Password (min. 8 characters)"
                  value={signupPassword}
                  onChange={setSignupPassword}
                  show={showSignupPw}
                  toggle={() => setShowSignupPw(v => !v)}
                />
                {signupPassword.length > 0 && (
                  <View style={s.strengthWrap}>
                    <View style={s.strengthTrack}>
                      <View style={[s.strengthFill, { width: `${pwStrength * 25}%` as any, backgroundColor: STRENGTH_COLOR[pwStrength] }]} />
                    </View>
                    <Text style={[s.strengthLabel, { color: STRENGTH_COLOR[pwStrength] }]}>
                      {STRENGTH_LABEL[pwStrength]}
                    </Text>
                  </View>
                )}

                <GlassPwField
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  show={showConfirmPw}
                  toggle={() => setShowConfirmPw(v => !v)}
                />
                {confirmPassword.length > 0 && signupPassword !== confirmPassword && (
                  <Text style={s.fieldError}>⚠ Passwords do not match</Text>
                )}

                {/* Terms */}
                <TouchableOpacity style={s.termsRow} onPress={() => setAgreedToTerms(v => !v)} activeOpacity={0.7}>
                  <View style={[s.checkbox, agreedToTerms && s.checkboxOn]}>
                    {agreedToTerms && <Text style={s.checkmark}>✓</Text>}
                  </View>
                  <Text style={s.termsText}>
                    I agree to the <Text style={s.termsLink}>Terms of Service</Text> and <Text style={s.termsLink}>Privacy Policy</Text>
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.goldBtn, (!agreedToTerms || loading) && s.disabled]}
                  onPress={handleSignup}
                  disabled={!agreedToTerms || loading}
                >
                  {loading
                    ? <ActivityIndicator color={C.navy} size="small" />
                    : <Text style={s.goldBtnText}>Create Account →</Text>}
                </TouchableOpacity>

                <Text style={s.switchText}>
                  Already have an account?{'  '}
                  <Text style={s.switchLink} onPress={() => setTab('login')}>Log In</Text>
                </Text>
              </View>
            )}

            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ── Glass Input ───────────────────────────────────────────────────────────────
function GlassInput({
  placeholder, value, onChangeText, keyboardType, autoCapitalize,
  autoComplete, returnKeyType, icon,
}: {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: any;
  autoCapitalize?: any;
  autoComplete?: any;
  returnKeyType?: any;
  icon?: string;
}) {
  return (
    <View style={s.glassInputRow}>
      {icon && <Text style={s.inputIcon}>{icon}</Text>}
      <TextInput
        style={s.glassInput}
        placeholder={placeholder}
        placeholderTextColor={C.white35}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
      />
    </View>
  );
}

// ── Glass Password Field ──────────────────────────────────────────────────────
function GlassPwField({
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
    <View style={s.glassInputRow}>
      <Text style={s.inputIcon}>🔒</Text>
      <TextInput
        style={[s.glassInput, { flex: 1 }]}
        placeholder={placeholder}
        placeholderTextColor={C.white35}
        value={value}
        onChangeText={onChange}
        secureTextEntry={!show}
        autoComplete="password"
        returnKeyType={returnKeyType ?? 'done'}
        onSubmitEditing={onSubmit}
      />
      <TouchableOpacity onPress={toggle} style={s.eyeBtn}>
        <Text style={s.eyeIcon}>{show ? '🙈' : '👁️'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg:      { flex: 1, backgroundColor: C.navy },
  safe:    { flex: 1 },
  scroll:  { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },

  // ── hero ──
  hero: { alignItems: 'center', marginBottom: 28, marginTop: 8 },
  logoRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: C.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  logoInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.goldDim, alignItems: 'center', justifyContent: 'center' },
  logoEmoji: { fontSize: 30 },
  appName:  { fontSize: 38, fontWeight: '800', color: C.white, letterSpacing: 3, marginBottom: 4 },
  tagline:  { fontSize: 13, color: C.white60, letterSpacing: 0.5 },

  // ── social ──
  socialRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  socialBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.white12, borderWidth: 1, borderColor: C.white18,
    borderRadius: 14, paddingVertical: 14,
  },
  appleSocialBtn: { backgroundColor: 'rgba(0,0,0,0.4)', borderColor: C.white18 },
  socialBtnText: { fontSize: 14, fontWeight: '600', color: C.white },
  gIconWrap: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  gIconText: { fontSize: 11, fontWeight: '800', color: '#4285F4', lineHeight: 14 },
  appleIconText: { fontSize: 17, color: C.white, lineHeight: 20 },

  // ── divider ──
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.white18 },
  dividerText: { fontSize: 11, color: C.white35, textTransform: 'uppercase', letterSpacing: 1 },

  // ── tab bar ──
  tabBar: { flexDirection: 'row', backgroundColor: C.white08, borderRadius: 14, padding: 4, marginBottom: 22, borderWidth: 1, borderColor: C.white12 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 11 },
  tabBtnActive: { backgroundColor: C.gold },
  tabBtnText: { fontSize: 14, fontWeight: '600', color: C.white60 },
  tabBtnTextActive: { color: C.navy, fontWeight: '800' },

  // ── form ──
  form: { gap: 13 },

  // ── glass input ──
  glassInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13,
  },
  inputIcon: { fontSize: 15, width: 20, textAlign: 'center', opacity: 0.6 },
  glassInput: { flex: 1, fontSize: 14, color: C.white },

  // ── eye ──
  eyeBtn: { paddingLeft: 8 },
  eyeIcon: { fontSize: 16 },

  // ── phone ──
  phoneRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
    borderRadius: 14, overflow: 'hidden',
  },
  phonePrefixWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 13, borderRightWidth: 1, borderRightColor: C.inputBorder },
  phoneFlag: { fontSize: 16 },
  phonePrefix: { fontSize: 13, color: C.white60, fontWeight: '600' },
  phoneInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: C.white },

  // ── strength ──
  strengthWrap: { gap: 5, marginTop: -4 },
  strengthTrack: { height: 4, backgroundColor: C.white12, borderRadius: 2, overflow: 'hidden' },
  strengthFill: { height: '100%', borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: '600' },

  // ── terms ──
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.white35, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.gold, borderColor: C.gold },
  checkmark: { color: C.navy, fontSize: 12, fontWeight: '800' },
  termsText: { flex: 1, fontSize: 12, color: C.white60, lineHeight: 19 },
  termsLink: { color: C.gold, fontWeight: '600' },

  // ── buttons ──
  goldBtn: { backgroundColor: C.gold, borderRadius: 14, paddingVertical: 16, alignItems: 'center', shadowColor: C.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 },
  goldBtnText: { color: C.navy, fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  ghostBtn: { alignItems: 'center', paddingVertical: 12 },
  ghostBtnText: { color: C.white60, fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.40 },

  forgotWrap: { alignItems: 'center', marginTop: -2 },
  forgotText: { color: C.gold, fontSize: 13, fontWeight: '600' },

  switchText: { textAlign: 'center', fontSize: 13, color: C.white60 },
  switchLink: { color: C.gold, fontWeight: '700' },
  fieldError: { fontSize: 11, color: C.red, marginTop: -4 },

  // ── verification ──
  verifyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  verifyIconRing: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  verifyIconInner: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.goldDim, alignItems: 'center', justifyContent: 'center' },
  verifyEmoji: { fontSize: 36 },
  verifyTitle: { fontSize: 26, fontWeight: '800', color: C.white, marginBottom: 14, textAlign: 'center' },
  verifyBody: { fontSize: 15, color: C.white60, textAlign: 'center', lineHeight: 24, marginBottom: 28 },
  verifyHighlight: { fontWeight: '700', color: C.gold },
});
