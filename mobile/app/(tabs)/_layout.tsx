import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Animated } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccessKey, fetchRestaurants } from '@/lib/api';

import { useRestaurant } from '@/lib/RestaurantContext';
import { DataProvider } from '@/lib/DataContext';

// ─── State Machine ────────────────────────────────────────────────────
// Replaces boolean flags with explicit, predictable states.
// Flow: CHECKING → GATE → AUTHENTICATING → SPLASH → READY
type AppState = 'CHECKING' | 'GATE' | 'AUTHENTICATING' | 'SPLASH' | 'READY';

export default function TabLayout() {
  const router = useRouter();
  const { activeName, activeId } = useRestaurant();

  const [appState, setAppState] = useState<AppState>('CHECKING');
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState(false);

  // Splash animation
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.9)).current;

  // ─── CHECKING: Read stored key → GATE (no key) or SPLASH (key exists) ──
  useEffect(() => {
    AsyncStorage.getItem('accessKey').then(key => {
      if (key) {
        setAppState('SPLASH'); // Returning user → branded splash → dashboard
      } else {
        setAppState('GATE');   // New user → access key first
      }
    });
  }, []);

  // ─── SPLASH: Animate in, hold 1.5s, then → READY ──────────────────
  useEffect(() => {
    if (appState !== 'SPLASH') return;

    // Reset animation values for fresh start
    splashOpacity.setValue(0);
    splashScale.setValue(0.9);

    Animated.parallel([
      Animated.timing(splashOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(splashScale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setAppState('READY');
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [appState, splashOpacity, splashScale]);

  // ─── AUTHENTICATING: Validate the key ──────────────────────────────
  const handleSubmit = async () => {
    if (!inputKey.trim()) return;
    setError(false);
    setAppState('AUTHENTICATING');

    try {
      await AsyncStorage.setItem('accessKey', inputKey.trim());
      await setAccessKey(inputKey.trim());
      await fetchRestaurants();

      // Success → branded splash then dashboard
      setAppState('SPLASH');
    } catch (e) {
      console.error('Key validation failed:', e);
      setError(true);
      setAppState('GATE');
      await AsyncStorage.removeItem('accessKey');
    }
  };

  // ─── Render based on state ─────────────────────────────────────────

  // CHECKING: Brief spinner while reading AsyncStorage
  if (appState === 'CHECKING') {
    return (
      <View style={[styles.gateContainer, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent.gold} />
      </View>
    );
  }

  // GATE / AUTHENTICATING: Access key input
  if (appState === 'GATE' || appState === 'AUTHENTICATING') {
    return (
      <View style={styles.gateContainer}>
        <View style={styles.gateCard}>
          <Ionicons name="lock-closed" size={48} color={colors.accent.gold} style={{ marginBottom: spacing.md }} />
          <Text style={styles.gateTitle}>Beta Access</Text>
          <Text style={styles.gateDesc}>Please enter your secret access key to continue to SavorIQ.</Text>

          <TextInput
            style={styles.input}
            placeholder="Access Key"
            placeholderTextColor={colors.text.muted}
            value={inputKey}
            onChangeText={(t) => {
              setInputKey(t);
              setError(false);
            }}
            secureTextEntry
            autoFocus
            editable={appState !== 'AUTHENTICATING'}
          />

          {error && <Text style={styles.errorText}>Invalid key. Please try again.</Text>}

          <TouchableOpacity
            style={[styles.button, appState === 'AUTHENTICATING' && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={appState === 'AUTHENTICATING'}
          >
            {appState === 'AUTHENTICATING' ? (
              <ActivityIndicator color={colors.bg.primary} />
            ) : (
              <Text style={styles.buttonText}>Enter Dashboard</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // SPLASH: Branded loading screen with logo + restaurant name
  if (appState === 'SPLASH') {
    return (
      <View style={styles.splashContainer}>
        <Animated.View style={[styles.splashContent, { opacity: splashOpacity, transform: [{ scale: splashScale }] }]}>
          <View style={styles.splashLogoRow}>
            <Ionicons name="sparkles" size={28} color={colors.accent.gold} />
          </View>
          <Text style={styles.splashBrand}>SavorIQ</Text>
          <Text style={styles.splashSubtitle}>Intelligence for your restaurant</Text>
          {activeName ? (
            <Text style={styles.splashLocation}>{activeName}</Text>
          ) : null}
          <ActivityIndicator
            size="small"
            color={colors.accent.gold}
            style={{ marginTop: spacing.xl }}
          />
        </Animated.View>
      </View>
    );
  }

  // READY: Main app with tabs + data provider (only loads after auth)
  return (
    <DataProvider>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent.gold,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarStyle: {
          backgroundColor: colors.bg.secondary,
          borderTopColor: colors.border.subtle,
          height: 88,
          paddingBottom: 28,
          paddingTop: 8,
        },
        headerStyle: {
          backgroundColor: colors.bg.primary,
          borderBottomWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
          height: 100,
        },
        headerTintColor: colors.text.primary,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
        headerTitleAlign: 'left' as const,
        headerRight: () => (
          <TouchableOpacity
            style={styles.headerLocation}
            onPress={() => {
              router.push('/more');
            }}
          >
            <Ionicons name="location" size={14} color={colors.accent.gold} />
            <Text style={styles.headerLocationText} numberOfLines={1}>
              {activeId ? activeName : 'Select Location'}
            </Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="guests"
        options={{
          title: 'Guests',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reviews"
        options={{
          title: 'Reviews',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </DataProvider>
  );
}

const styles = StyleSheet.create({
  // ─── Gate (access key entry) ─────────────────────────────────────
  gateContainer: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: spacing.lg,
  },
  gateCard: {
    width: '100%',
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  gateTitle: {
    color: colors.text.primary,
    fontSize: fonts.sizes.xxl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  gateDesc: {
    color: colors.text.secondary,
    fontSize: fonts.sizes.md,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  input: {
    width: '100%',
    height: 56,
    backgroundColor: colors.bg.input,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    color: colors.text.primary,
    paddingHorizontal: spacing.md,
    fontSize: fonts.sizes.lg,
    marginBottom: spacing.md,
  },
  button: {
    width: '100%',
    height: 56,
    backgroundColor: colors.accent.gold,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: colors.bg.primary,
    fontSize: fonts.sizes.md,
    fontWeight: '700',
  },
  errorText: {
    color: colors.accent.red,
    fontSize: fonts.sizes.sm,
    marginBottom: spacing.md,
  },

  // ─── Branded Splash ──────────────────────────────────────────────
  splashContainer: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashContent: {
    alignItems: 'center',
  },
  splashLogoRow: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accent.gold + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  splashBrand: {
    color: colors.accent.gold,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  splashSubtitle: {
    color: colors.text.muted,
    fontSize: fonts.sizes.md,
    marginTop: spacing.xs,
  },
  splashLocation: {
    color: colors.text.secondary,
    fontSize: fonts.sizes.lg,
    fontWeight: '600',
    marginTop: spacing.lg,
  },

  // ─── Header location pill ────────────────────────────────────────
  headerLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginRight: spacing.md,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  headerLocationText: {
    color: colors.text.secondary,
    fontSize: fonts.sizes.xs,
    fontWeight: '600',
    maxWidth: 120,
  },
});
