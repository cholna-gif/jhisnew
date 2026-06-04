import { useState, ComponentProps } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { AuthAPI } from '@/lib/api';
import { formatKhMask, sanitizeKhDigits, isValidKhPhone, composeKhPhone } from '@/lib/phone';

WebBrowser.maybeCompleteAuthSession();

type Tab = 'login' | 'signup';
type ResetStep = 'request' | 'confirm';

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
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationAction, setVerificationAction] = useState<'verify' | 'resend' | null>(null);
  const [resetStep, setResetStep] = useState<ResetStep | null>(null);
  const [resetAction, setResetAction] = useState<'send' | 'reset' | 'resend' | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPw, setShowResetPw] = useState(false);
  const [showResetConfirmPw, setShowResetConfirmPw] = useState(false);

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
    const email = signupEmail.trim().toLowerCase();
    const phone = phoneDigits.length > 0 ? composeKhPhone(phoneDigits) : undefined;
    const { error, needsVerification } = await signUp(email, signupPassword, fullName.trim(), phone);
    setLoading(false);

    if (error) { Alert.alert('Sign Up Failed', error); return; }

    if (needsVerification) {
      setVerificationEmail(email);
      setVerificationCode('');
    } else {
      Alert.alert('Account Created!', 'Your account is ready. Please log in.', [{ text: 'Go to Login', onPress: () => setTab('login') }]);
    }
  };

  const handleResend = async () => {
    setVerificationAction('resend');
    try {
      await AuthAPI.resendVerification(verificationEmail);
      setVerificationCode('');
      Alert.alert('Sent!', 'Verification code resent. Check your inbox.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not resend verification code.');
    }
    setVerificationAction(null);
  };

  const handleVerifyEmail = async () => {
    if (verificationCode.length !== 6) {
      Alert.alert('Missing code', 'Enter the 6-digit code from your email.');
      return;
    }

    setVerificationAction('verify');
    try {
      await AuthAPI.verifyEmail(verificationEmail, verificationCode);
      setLoginEmail(verificationEmail);
      setVerificationEmail('');
      setVerificationCode('');
      setTab('login');
      Alert.alert('Email verified', 'Your account is ready. Please log in.');
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message ?? 'Could not verify email.');
    }
    setVerificationAction(null);
  };

  const openResetPassword = () => {
    setResetEmail(loginEmail.trim().toLowerCase());
    setResetCode('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResetStep('request');
  };

  const handleRequestReset = async (isResend = false) => {
    const email = resetEmail.trim().toLowerCase();
    if (!email) {
      Alert.alert('Missing email', 'Enter your email address first.');
      return;
    }

    setResetAction(isResend ? 'resend' : 'send');
    try {
      await AuthAPI.requestPasswordReset(email);
      setResetEmail(email);
      setResetCode('');
      setResetStep('confirm');
      if (isResend) Alert.alert('Sent!', 'Reset code resent. Check your inbox.');
    } catch (err: any) {
      Alert.alert('Reset Failed', err.message ?? 'Could not send reset code.');
    }
    setResetAction(null);
  };

  const handleResetPassword = async () => {
    if (resetCode.length !== 6) {
      Alert.alert('Missing code', 'Enter the 6-digit code from your email.');
      return;
    }
    if (resetPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      Alert.alert('Passwords do not match', 'Please re-enter your password.');
      return;
    }

    setResetAction('reset');
    try {
      await AuthAPI.resetPassword(resetEmail, resetCode, resetPassword);
      setLoginEmail(resetEmail);
      setResetStep(null);
      setResetCode('');
      setResetPassword('');
      setResetConfirmPassword('');
      Alert.alert('Password reset', 'Your password was updated. Please log in.');
    } catch (err: any) {
      Alert.alert('Reset Failed', err.message ?? 'Could not reset password.');
    }
    setResetAction(null);
  };

  // ── Reset password screen ─────────────────────────────────────────────────
  if (resetStep) {
    return (
      <View style={s.bg}>
        <SafeAreaView style={s.safe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.verifyWrap}>
              <View style={s.verifyIconRing}>
                <View style={s.verifyIconInner}>
                  <Text style={s.verifyEmoji}>🔒</Text>
                </View>
              </View>
              <Text style={s.verifyTitle}>Reset password</Text>
              {resetStep === 'request' ? (
                <View style={s.resetForm}>
                  <Text style={s.verifyBody}>Enter your account email and we will send a 6-digit reset code.</Text>
                  <GlassInput
                    placeholder="Email address"
                    value={resetEmail}
                    onChangeText={setResetEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    returnKeyType="done"
                    icon="mail"
                  />
                  <TouchableOpacity
                    style={[s.goldBtn, resetAction && s.disabled]}
                    onPress={() => handleRequestReset(false)}
                    disabled={!!resetAction}
                  >
                    {resetAction === 'send'
                      ? <ActivityIndicator color={C.navy} size="small" />
                      : <Text style={s.goldBtnText}>Send Reset Code</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.resetForm}>
                  <Text style={s.verifyBody}>
                    Enter the code sent to{'\n'}
                    <Text style={s.verifyHighlight}>{resetEmail}</Text>
                  </Text>
                  <View style={s.codeInputRow}>
                    <TextInput
                      style={s.codeInput}
                      placeholder="000000"
                      placeholderTextColor={C.white35}
                      value={resetCode}
                      onChangeText={value => setResetCode(value.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      maxLength={6}
                      textContentType="oneTimeCode"
                    />
                  </View>
                  <GlassPwField
                    placeholder="New password"
                    value={resetPassword}
                    onChange={setResetPassword}
                    show={showResetPw}
                    toggle={() => setShowResetPw(v => !v)}
                  />
                  <GlassPwField
                    placeholder="Confirm new password"
                    value={resetConfirmPassword}
                    onChange={setResetConfirmPassword}
                    show={showResetConfirmPw}
                    toggle={() => setShowResetConfirmPw(v => !v)}
                  />
                  <TouchableOpacity
                    style={[s.goldBtn, resetAction && s.disabled]}
                    onPress={handleResetPassword}
                    disabled={!!resetAction}
                  >
                    {resetAction === 'reset'
                      ? <ActivityIndicator color={C.navy} size="small" />
                      : <Text style={s.goldBtnText}>Update Password</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.ghostBtn, resetAction && s.disabled]}
                    onPress={() => handleRequestReset(true)}
                    disabled={!!resetAction}
                  >
                    <Text style={s.ghostBtnText}>
                      {resetAction === 'resend' ? 'Sending...' : 'Resend Code'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity style={s.ghostBtn} onPress={() => setResetStep(null)}>
                <Text style={s.ghostBtnText}>← Back to Login</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

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
              We sent a 6-digit confirmation code to{'\n'}
              <Text style={s.verifyHighlight}>{verificationEmail}</Text>
              {'\n\n'}Enter it here to activate your account.
            </Text>
            <View style={s.codeInputRow}>
              <TextInput
                style={s.codeInput}
                placeholder="000000"
                placeholderTextColor={C.white35}
                value={verificationCode}
                onChangeText={value => setVerificationCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
              />
            </View>
            <TouchableOpacity
              style={[s.goldBtn, verificationAction && s.disabled]}
              onPress={handleVerifyEmail}
              disabled={!!verificationAction}
            >
              {verificationAction === 'verify'
                ? <ActivityIndicator color={C.navy} size="small" />
                : <Text style={s.goldBtnText}>Verify Email</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.goldBtn, verificationAction && s.disabled]}
              onPress={handleResend}
              disabled={!!verificationAction}
            >
              {verificationAction === 'resend'
                ? <ActivityIndicator color={C.navy} size="small" />
                : <Text style={s.goldBtnText}>Resend Code</Text>}
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
              <View style={s.logoSquare}>
                <Text style={s.logoSquareText}>Jih</Text>
              </View>
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
                  icon="mail"
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
                  onPress={openResetPassword}
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
                  icon="user"
                />
                <GlassInput
                  placeholder="Email address"
                  value={signupEmail}
                  onChangeText={setSignupEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="next"
                  icon="mail"
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
  icon?: ComponentProps<typeof Feather>['name'];
}) {
  return (
    <View style={s.glassInputRow}>
      {icon && <Feather name={icon} size={16} color={C.white35} style={s.inputIcon} />}
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
      <Feather name="lock" size={16} color={C.white35} style={s.inputIcon} />
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
        <Feather name={show ? 'eye-off' : 'eye'} size={18} color={C.white35} />
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
  logoSquare: {
    width: 100, height: 100, borderRadius: 22,
    backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#7BB8D9',
    shadowColor: '#7BB8D9', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55, shadowRadius: 14, elevation: 8,
    marginBottom: 16,
  },
  logoSquareText: { fontSize: 44, fontWeight: '900', color: C.white, letterSpacing: -1 },
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
  resetForm: { width: '100%', gap: 14 },
  codeInputRow: { width: '100%', marginBottom: 14 },
  codeInput: {
    width: '100%', textAlign: 'center', color: C.white, fontSize: 28, fontWeight: '800',
    letterSpacing: 8, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
    borderRadius: 14, paddingVertical: 14,
  },
});
