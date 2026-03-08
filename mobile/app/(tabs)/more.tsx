import {
    View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setApiBase, getApiBase, resetAndSync } from '@/lib/api';
import { useState, useEffect } from 'react';
import Constants from 'expo-constants';

export default function MoreScreen() {
    const router = useRouter();
    const { restaurants, activeId, activeName, switchRestaurant, loadRestaurants } = useRestaurant();
    const { refreshAll } = useData();

    const [currentApi, setCurrentApi] = useState<string>('Loading...');
    const [syncing, setSyncing] = useState(false);

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

    const handleSyncNow = async () => {
        if (!activeId) return;

        Alert.alert(
            'Smart Sync',
            'This will fetch the latest reviews and check for deletions to keep your counts accurate. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sync Now',
                    onPress: async () => {
                        setSyncing(true);
                        try {
                            const res = await resetAndSync(activeId);
                            if (res.status === 'success') {
                                // Extract info from results if available
                                const details = res.results?.map((r: any) =>
                                    `${r.platform}: ${r.new_ingested} new, ${r.mode === 'full' ? 'audited for deletions' : 'delta sync'}`
                                ).join('\n');

                                Alert.alert('Sync Complete', details || 'Data has been updated.');
                                await refreshAll();
                                await loadRestaurants();
                            } else {
                                Alert.alert('Sync Error', res.message || 'Failed to start sync.');
                            }
                        } catch (e: any) {
                            Alert.alert('Sync Limited', e.message || 'Please wait before syncing again.');
                        } finally {
                            setSyncing(false);
                        }
                    }
                }
            ]
        );
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
                                <Text style={s.locationUrl} numberOfLines={1}>
                                    {r.address || r.platform_url || 'No address provided'}
                                </Text>
                            </View>
                            {r.id === activeId && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <TouchableOpacity
                                        style={[s.syncBtnInline, syncing && { opacity: 0.7 }]}
                                        onPress={handleSyncNow}
                                        disabled={syncing}
                                    >
                                        {syncing ? (
                                            <ActivityIndicator size="small" color={colors.accent.gold} />
                                        ) : (
                                            <>
                                                <Ionicons name="sync" size={14} color={colors.accent.gold} />
                                                <Text style={s.syncBtnText}>Sync Now</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                    <View style={s.activeBadge}>
                                        <Text style={s.activeText}>Active</Text>
                                    </View>
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

            {/* Data Sources Explanation */}
            <View style={s.section}>
                <Text style={s.sectionTitle}>Data Sources</Text>
                <View style={s.dataSourcesCard}>
                    <View style={s.sourceItem}>
                        <Ionicons name="logo-google" size={16} color="#4285F4" />
                        <Text style={s.sourceText}>Google Maps Reviews (Scraped via Apify)</Text>
                    </View>
                    <View style={s.sourceItem}>
                        <Ionicons name="star-outline" size={16} color="#FF1A1A" />
                        <Text style={s.sourceText}>Yelp Fusion & Scraper (Apify)</Text>
                    </View>
                    <Text style={s.sourceDisclaimer}>
                        Reviews are synced periodically to ensure sentiment scores reflect the latest customer feedback.
                    </Text>
                </View>
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

                {/* API Switcher */}
                <View style={s.apiCard}>
                    <Text style={s.apiCurrentLabel}>Switch Environment:</Text>
                    <View style={s.apiBtnRow}>
                        <TouchableOpacity
                            style={s.apiBtn}
                            onPress={() => handleSwitchApi(null, 'Production')}
                        >
                            <Text style={s.apiBtnText}>Cloud (Public)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={s.apiBtn}
                            onPress={() => handleSwitchApi('http://localhost:8000', 'Local')}
                        >
                            <Text style={s.apiBtnText}>Local (Dev)</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={s.apiDesc}>
                        Switch to "Local" to see changes I'm making to your local database/code.
                    </Text>
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

    syncBtnInline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.bg.secondary,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.accent.gold + '40',
    },
    syncBtnText: { color: colors.accent.gold, fontSize: 10, fontWeight: '700' },

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

    dataSourcesCard: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, borderWidth: 1, borderColor: colors.border.subtle,
    },
    sourceItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    sourceText: { color: colors.text.secondary, fontSize: fonts.sizes.sm },
    sourceDisclaimer: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: spacing.sm, fontStyle: 'italic' },
});
