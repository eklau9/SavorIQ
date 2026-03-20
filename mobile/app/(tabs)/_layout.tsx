import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccessKey, fetchRestaurants } from '@/lib/api';

import { useRestaurant } from '@/lib/RestaurantContext';
import { DataProvider } from '@/lib/DataContext';

// ─── State Machine ────────────────────────────────────────────────────
// Flow: LOADING → READY  (if cached key is valid)
//       LOADING → GATE → AUTHENTICATING → READY
type AppState = 'LOADING' | 'GATE' | 'AUTHENTICATING' | 'READY';

export default function TabLayout() {
  const router = useRouter();
  const { activeName, activeId } = useRestaurant();

  const [appState, setAppState] = useState<AppState>('LOADING');
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState(false);

  // Check for cached access key on mount — auto-skip gate if valid
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem('accessKey');
        if (cancelled) return;
        if (cached) {
          // Validate the cached key by attempting a fetch
          await setAccessKey(cached);
          await fetchRestaurants();
          if (!cancelled) setAppState('READY');
        } else {
          if (!cancelled) setAppState('GATE');
        }
      } catch (e) {
        // Cached key is invalid — clear it and show gate
        await AsyncStorage.removeItem('accessKey');
        if (!cancelled) setAppState('GATE');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── AUTHENTICATING: Validate the key ──────────────────────────────
  const handleSubmit = async () => {
    if (!inputKey.trim()) return;
    setError(false);
    setAppState('AUTHENTICATING');

    try {
      await AsyncStorage.setItem('accessKey', inputKey.trim());
      await setAccessKey(inputKey.trim());
      await fetchRestaurants();

      // Success → straight to dashboard (DataProvider handles loading UI)
      setAppState('READY');
    } catch (e) {
      console.error('Key validation failed:', e);
      setError(true);
      setAppState('GATE');
      await AsyncStorage.removeItem('accessKey');
    }
  };

  // ─── Render based on state ─────────────────────────────────────────

  // LOADING: Checking cached key
  if (appState === 'LOADING') {
    return (
      <View style={styles.gateContainer}>
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

  // READY: DataProvider mounts → its StartupLoadingScreen shows while loading → then dashboard
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
