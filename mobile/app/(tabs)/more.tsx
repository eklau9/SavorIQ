import React from 'react';
import {
    View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setApiBase, getApiBase } from '@/lib/api';
import { useState, useEffect } from 'react';
import Constants from 'expo-constants';

export default function MoreScreen() {
    const router = useRouter();
    const { restaurants, activeId, activeName, switchRestaurant, loadRestaurants } = useRestaurant();

    const [currentApi, setCurrentApi] = useState<string>('Loading...');

    useEffect(() => {
        (async () => {
            const api = await getApiBase();
            setCurrentApi(api);
        })();
    }, []);

    const handleSignOut = async () => {
        Alert.alert('Sign Out', 'Are you sure you want to clear your access key?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign Out',
                style: 'destructive',
                onPress: async () => {
                    await AsyncStorage.removeItem('accessKey');
                    // Force reload or redirect would happen on next layout check
                    alert('Access key cleared. Please reload the app.');
                }
            }
        ]);
    };

    const handleSwitchApi = async (url: string | null, label: string) => {
        await setApiBase(url);
        const newApi = await getApiBase();
        setCurrentApi(newApi);

        // Re-fetch restaurants immediately to update the list
        await loadRestaurants();

        Alert.alert('API Switched', `Now using ${label}: ${newApi}.`, [
            { text: 'OK' }
        ]);
    };

    return (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
            {/* Restaurant Switcher */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>Active Location</Text>
                {restaurants.length === 0 ? (
                    <View style={s.emptyBox}>
                        <Text style={s.emptyText}>No locations found.</Text>
                        <TouchableOpacity style={s.reloadTiny} onPress={loadRestaurants}>
                            <Text style={s.reloadTinyText}>Reload</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    restaurants.map((r) => (
                        <TouchableOpacity
                            key={r.id}
                            style={[s.locationRow, r.id === activeId && s.locationRowActive]}
                            onPress={() => switchRestaurant(r.id)}
                        >
                            <Ionicons
                                name={r.id === activeId ? 'radio-button-on' : 'radio-button-off'}
                                size={20}
                                color={r.id === activeId ? colors.accent.gold : colors.text.muted}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={[s.locationName, r.id === activeId && { color: colors.accent.gold }]}>
                                    {r.name}
                                </Text>
                                <Text style={s.locationUrl} numberOfLines={1}>{r.platform_url}</Text>
                            </View>
                            {r.id === activeId && (
                                <View style={s.activeBadge}>
                                    <Text style={s.activeText}>Active</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    ))
                )}
            </View>

            {/* Quick Links */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>Tools</Text>
                <MenuItem
                    icon="sync"
                    label="Review Sync"
                    subtitle="Fetch new reviews from Google & Yelp"
                    onPress={() => router.push('/sync')}
                />
                <MenuItem icon="analytics" label="Sentiment Analysis" subtitle="Detailed sentiment breakdowns" />
                <MenuItem icon="bar-chart" label="Operations Analytics" subtitle="Revenue & performance metrics" />
            </View>

            {/* API Settings */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>API Environment</Text>
                <View style={s.apiCard}>
                    <Text style={s.apiCurrentLabel}>Current: <Text style={{ color: colors.accent.gold }}>{currentApi}</Text></Text>
                    <View style={s.apiBtnRow}>
                        <TouchableOpacity style={s.apiBtn} onPress={() => handleSwitchApi(null, 'Default')}>
                            <Text style={s.apiBtnText}>Auto</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.apiBtn} onPress={() => handleSwitchApi('http://192.168.68.58:8000', 'Local Mac')}>
                            <Text style={s.apiBtnText}>Local Mac</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.apiBtn} onPress={() => handleSwitchApi('https://savoriq-api-production.up.railway.app', 'Railway')}>
                            <Text style={s.apiBtnText}>Railway</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={s.apiDesc}>Use 'Local Mac' if on the same WiFi as your computer for much faster performance.</Text>
                </View>
            </View>

            {/* Account */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>Account</Text>
                <MenuItem
                    icon="log-out"
                    label="Reset Access Key"
                    subtitle="Clear current secret key"
                    onPress={handleSignOut}
                />
            </View>

            {/* App Info */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>Connectivity Debug</Text>
                <View style={s.infoRow}>
                    <Text style={s.infoLabel}>Host URI</Text>
                    <Text style={s.infoValue}>{Constants.expoConfig?.hostUri || 'None'}</Text>
                </View>
                <View style={s.infoRow}>
                    <Text style={s.infoLabel}>Active API URL</Text>
                    <Text style={s.infoValue}>{currentApi}</Text>
                </View>
                <View style={s.infoRow}>
                    <Text style={s.infoLabel}>App Version</Text>
                    <Text style={s.infoValue}>1.0.0</Text>
                </View>
            </View>
        </ScrollView>
    );
}

function MenuItem({ icon, label, subtitle, onPress }: {
    icon: string; label: string; subtitle: string; onPress?: () => void;
}) {
    return (
        <TouchableOpacity style={s.menuItem} activeOpacity={0.7} onPress={onPress}>
            <View style={s.menuIconWrap}>
                <Ionicons name={icon as any} size={20} color={colors.accent.blue} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={s.menuLabel}>{label}</Text>
                <Text style={s.menuSubtitle}>{subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </TouchableOpacity>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    content: { padding: spacing.md, paddingBottom: 40 },

    section: { marginBottom: spacing.lg },
    sectionTitle: {
        color: colors.text.muted, fontSize: fonts.sizes.xs,
        fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1,
        marginBottom: spacing.sm,
    },

    locationRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    locationRowActive: { borderColor: colors.accent.gold + '40' },
    locationName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    locationUrl: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },
    activeBadge: {
        backgroundColor: colors.accent.gold + '20',
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm,
    },
    activeText: { color: colors.accent.gold, fontSize: fonts.sizes.xs, fontWeight: '700' },

    menuItem: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    menuIconWrap: {
        width: 36, height: 36, borderRadius: radius.sm,
        backgroundColor: colors.accent.blue + '15',
        justifyContent: 'center', alignItems: 'center',
    },
    menuLabel: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    menuSubtitle: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },

    infoRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
    },
    infoLabel: { color: colors.text.secondary, fontSize: fonts.sizes.sm },
    infoValue: { color: colors.text.muted, fontSize: fonts.sizes.sm },
    emptyBox: {
        padding: spacing.md, backgroundColor: colors.bg.card,
        borderRadius: radius.md, alignItems: 'center', gap: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle, borderStyle: 'dashed',
    },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.sm },
    reloadTiny: {
        paddingHorizontal: 16, paddingVertical: 6,
        backgroundColor: colors.accent.gold + '20', borderRadius: radius.sm,
    },
    reloadTinyText: { color: colors.accent.gold, fontWeight: '700', fontSize: fonts.sizes.xs },
    apiCard: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, borderWidth: 1, borderColor: colors.border.subtle,
    },
    apiCurrentLabel: { color: colors.text.secondary, fontSize: fonts.sizes.sm, marginBottom: spacing.md },
    apiBtnRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    apiBtn: {
        flex: 1, backgroundColor: colors.bg.secondary, padding: 8,
        borderRadius: radius.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.border.default,
    },
    apiBtnText: { color: colors.text.primary, fontSize: fonts.sizes.xs, fontWeight: '600' },
    apiDesc: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 4, lineHeight: 16 },
});
