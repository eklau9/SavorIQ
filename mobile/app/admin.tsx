import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '@/lib/theme';

/**
 * UNIFIED ADMIN LAUNCHER
 * This screen replaces the old redundant internal admin UI.
 * It serves as a single entry point to the high-power Command Center.
 */
export default function AdminScreen() {
    const router = useRouter();
    const ADMIN_URL = 'http://localhost:5175';

    const handleLaunch = async () => {
        try {
            await Linking.openURL(ADMIN_URL);
        } catch (err) {
            console.error('Failed to open Admin URL:', err);
        }
    };

    // Auto-launch on mount for maximum efficiency
    useEffect(() => {
        handleLaunch();
    }, []);

    return (
        <View style={s.container}>
            <Stack.Screen options={{ 
                headerShown: true, 
                title: 'Command Center',
                headerTransparent: true,
                headerTintColor: colors.text.primary,
                headerLeft: () => (
                    <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                        <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
                    </TouchableOpacity>
                )
            }} />

            <View style={s.content}>
                <View style={s.iconCircle}>
                    <Ionicons name="sparkles" size={48} color={colors.accent.gold} />
                </View>

                <Text style={s.title}>SavorIQ Admin</Text>
                <Text style={s.subtitle}>
                    Redirecting you to the high-power Command Center...
                </Text>

                <TouchableOpacity style={s.launchBtn} onPress={handleLaunch}>
                    <Text style={s.launchBtnText}>Enter Command Center</Text>
                    <Ionicons name="open-outline" size={18} color="white" />
                </TouchableOpacity>

                <View style={s.infoBox}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.text.muted} />
                    <Text style={s.infoText}>
                        The dedicated portal provides live AI quota tracking, system health, and deep analytics optimized for desktop browsers.
                    </Text>
                </View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backBtn: {
        marginLeft: spacing.sm,
    },
    content: {
        alignItems: 'center',
        padding: spacing.xl,
        width: '100%',
    },
    iconCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: colors.bg.card,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        shadowColor: colors.accent.gold,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 5,
    },
    title: {
        fontSize: 28,
        fontWeight: '800',
        color: colors.text.primary,
        marginBottom: spacing.xs,
    },
    subtitle: {
        fontSize: 14,
        color: colors.text.muted,
        textAlign: 'center',
        marginBottom: spacing.xl,
        lineHeight: 20,
    },
    launchBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.accent.blue,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        borderRadius: radius.full,
        gap: 8,
    },
    launchBtnText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '700',
    },
    infoBox: {
        marginTop: 60,
        flexDirection: 'row',
        backgroundColor: colors.bg.card,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        gap: 10,
        maxWidth: 300,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: colors.text.muted,
        lineHeight: 18,
    }
});
