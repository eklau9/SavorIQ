import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccessKey, fetchRestaurants } from '@/lib/api';

import { useRestaurant } from '@/lib/RestaurantContext';
import { DataProvider } from '@/lib/DataContext';

export default function TabLayout() {
  const router = useRouter();
  const { activeName, activeId } = useRestaurant();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    checkKey();
  }, []);

  const checkKey = async () => {
    const key = await AsyncStorage.getItem('accessKey');
    setHasKey(!!key);
  };

  const handleSubmit = async () => {
    if (!inputKey.trim()) return;
    setError(false);
    setHasKey(null); // Show loading
    try {
      // Temporarily set the key in a way the API client can use it for verification
      await AsyncStorage.setItem('accessKey', inputKey.trim());
      await setAccessKey(inputKey.trim());

      // Try to fetch something to verify the key
      await fetchRestaurants();

      setHasKey(true);
    } catch (e) {
      console.error('Key validation failed:', e);
      setError(true);
      setHasKey(false);
      await AsyncStorage.removeItem('accessKey');
    }
  };

  if (hasKey === null) {
    return (
      <View style={[styles.gateContainer, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent.gold} />
      </View>
    );
  }

  if (!hasKey) {
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
          />

          {error && <Text style={styles.errorText}>Invalid key. Please try again.</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSubmit}>
            <Text style={styles.buttonText}>Enter Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const content = (
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
          backgroundColor: colors.bg.secondary,
          borderBottomWidth: 1,
          borderBottomColor: colors.border.subtle,
        },
        headerTintColor: colors.text.primary,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="guests"
        options={{
          title: 'Guests',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reviews"
        options={{
          title: 'Reviews',
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
    </Tabs >
  );

  return (
    <DataProvider>
      {content}
    </DataProvider>
  );
}

const styles = StyleSheet.create({
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
