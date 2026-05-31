import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AuthScreen from './auth';

/**
 * Renders the auth screen directly (as a React component, not a route) when
 * the user has no session.  This avoids every navigation-timing/flash issue
 * that comes from trying to use router.replace() inside a useEffect.
 *
 * When a session exists the Stack shows the (tabs) group.  When the session is
 * destroyed (sign-out) this component re-renders and immediately shows the
 * login screen with zero flicker.
 */
function AppNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#D4AF37" />
      </View>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A2744',
  },
});
