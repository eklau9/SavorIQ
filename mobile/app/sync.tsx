import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    SectionList,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import * as Location from 'expo-location';
import { searchBusiness, syncApifyReviews, fetchSyncStatus, UnifiedBusiness } from '@/lib/api';
import { calculateDistance } from '../lib/geo';

export default function SyncScreen() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<UnifiedBusiness[] | null>(null);
    const [syncing, setSyncing] = useState<Record<string, boolean>>({});
    const [syncHistory, setSyncHistory] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

    useEffect(() => {
        loadStatus();
    }, []);

    const loadStatus = async () => {
        try {
            const status = await fetchSyncStatus();
            setSyncHistory(status);
        } catch (e) { }
    };

    const handleSearch = async () => {
        if (!name.trim()) return;
        setSearching(true);
        setError(null);
        setResults(null);

        try {
            let lat: number | null = null;
            let lng: number | null = null;

            // Only fetch GPS if manual location is NOT provided
            if (!location.trim()) {
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const pos = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                        });
                        lat = pos.coords.latitude;
                        lng = pos.coords.longitude;
                        setUserCoords({ lat, lng });
                        console.log(`[Sync] Using GPS bias: ${lat}, ${lng}`);
                    }
                } catch (gpsError) {
                    console.warn('[Sync] Could not fetch GPS location:', gpsError);
                    // Fallback to generic search if GPS fails
                }
            }

            const data = await searchBusiness(name.trim(), location.trim(), lat, lng);

            if (!data || !Array.isArray(data)) {
                const type = typeof data;
                const preview = data ? JSON.stringify(data).slice(0, 50) : 'null';
                throw new Error(`Search returned ${type} instead of array. [${preview}]`);
            }

            // Calc distance locally for sorting if GPS is active
            if (lat && lng) {
                for (const item of data) {
                    const g = item.google;
                    const y = item.yelp;
                    const b_lat = g?.latitude || y?.latitude;
                    const b_lng = g?.longitude || y?.longitude;
                    if (b_lat && b_lng) {
                        item.distance = calculateDistance(lat, lng, b_lat, b_lng);
                    }
                }
                data.sort((a, b) => (a.distance || 999) - (b.distance || 999));
            }

            setResults([...data]); // Use spread to ensure we force a fresh array reference

        } catch (e: any) {
            console.error('[SyncSearch] Error:', e);
            setError(e.message || 'Search failed');
        } finally {
            setSearching(false);
        }
    };

    const handleSync = async (item: UnifiedBusiness) => {
        const key = item.id;
        setSyncing(prev => ({ ...prev, [key]: true }));
        try {
            const syncs = [];
            if (item.google) {
                syncs.push(syncApifyReviews('google', item.google.url || item.google.id, item.google.name, item.google.address));
            }
            if (item.yelp) {
                syncs.push(syncApifyReviews('yelp', item.yelp.url || item.yelp.id, item.yelp.name, item.yelp.address));
            }

            await Promise.all(syncs);
            loadStatus();
            alert(`Sync started for ${item.name}. Data will appear in a few moments.`);
        } catch (e: any) {
            alert(`Sync error: ${e.message}`);
        } finally {
            setSyncing(prev => ({ ...prev, [key]: false }));
        }
    };

    const renderBizCard = ({ item }: { item: UnifiedBusiness }) => {
        const onCooldown = (item.google?.last_sync?.on_cooldown || item.yelp?.last_sync?.on_cooldown);
        const cooldownText = item.google?.last_sync?.ago || item.yelp?.last_sync?.ago;
        const isSyncing = syncing[item.id];

        const platforms = [];
        if (item.google) platforms.push('Google');
        if (item.yelp) platforms.push('Yelp');

        return (
            <View style={s.bizCard}>
                <View style={s.bizInfo}>
                    <Text style={s.bizName}>{item.name}</Text>
                    <Text style={s.bizAddr} numberOfLines={1}>{item.address}</Text>
                    <View style={s.bizMeta}>
                        <View style={s.metaItem}>
                            <Text style={s.bizRating}>⭐ {item.avg_rating}</Text>
                        </View>
                        <View style={s.metaDot} />
                        <View style={s.metaItem}>
                            <Text style={s.bizReviews}>{item.total_reviews} reviews</Text>
                        </View>
                        {item.distance !== null && (
                            <>
                                <View style={s.metaDot} />
                                <View style={s.metaItem}>
                                    <Ionicons name="location-outline" size={12} color={colors.text.muted} />
                                    <Text style={s.bizDistance}>{item.distance?.toFixed(1)} mi</Text>
                                </View>
                            </>
                        )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                        {item.google && (
                            <View style={[s.platBadge, { backgroundColor: '#4285F420' }]}>
                                <Ionicons name="logo-google" size={10} color="#4285F4" />
                                <Text style={[s.platText, { color: '#4285F4' }]}>Google</Text>
                            </View>
                        )}
                        {item.yelp && (
                            <View style={[s.platBadge, { backgroundColor: '#FF1A1A20' }]}>
                                <Ionicons name="star" size={10} color="#FF1A1A" />
                                <Text style={[s.platText, { color: '#FF1A1A' }]}>Yelp</Text>
                            </View>
                        )}
                    </View>
                </View>
                <TouchableOpacity
                    style={[s.syncBtn, isSyncing && { opacity: 0.6 }]}
                    disabled={isSyncing || onCooldown}
                    onPress={() => handleSync(item)}
                >
                    {isSyncing ? (
                        <ActivityIndicator size="small" color={colors.text.primary} />
                    ) : onCooldown ? (
                        <Text style={s.syncBtnText}>⏳ {cooldownText}</Text>
                    ) : (
                        <Text style={s.syncBtnText}>Sync</Text>
                    )}
                </TouchableOpacity>
            </View>
        );
    };


    return (
        <View style={s.container}>
            <Stack.Screen options={{ title: 'Review Sync', headerTitleStyle: { fontWeight: '700' } }} />

            <SectionList
                sections={results ? [{ title: 'Results', data: results }] : []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={s.content}
                stickySectionHeadersEnabled={false}
                ListHeaderComponent={
                    <>
                        <View style={s.header}>
                            <Text style={s.title}>Add New Restaurant</Text>
                            <Text style={s.subtitle}>Search Google & Yelp to fetch customer reviews</Text>
                        </View>

                        <View style={s.form}>
                            <View style={s.inputGroup}>
                                <Text style={s.label}>Business Name</Text>
                                <TextInput
                                    style={s.input}
                                    placeholder="e.g. Heytea Milpitas"
                                    placeholderTextColor={colors.text.muted}
                                    value={name}
                                    onChangeText={setName}
                                />
                            </View>
                            <View style={s.inputGroup}>
                                <Text style={s.label}>Location (Optional)</Text>
                                <TextInput
                                    style={s.input}
                                    placeholder="e.g. California"
                                    placeholderTextColor={colors.text.muted}
                                    value={location}
                                    onChangeText={setLocation}
                                />
                            </View>
                            <TouchableOpacity
                                style={[s.searchBtn, (!name.trim() || searching) && { opacity: 0.6 }]}
                                onPress={handleSearch}
                                disabled={!name.trim() || searching}
                            >
                                {searching ? (
                                    <ActivityIndicator color={colors.bg.primary} />
                                ) : (
                                    <>
                                        <Ionicons name="search" size={18} color={colors.bg.primary} />
                                        <Text style={s.searchBtnText}>Search Platforms</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                        {error && <Text style={s.errorText}>{error}</Text>}
                    </>
                }
                renderSectionHeader={() => null}
                renderItem={renderBizCard}
                SectionSeparatorComponent={() => <View style={{ height: spacing.md }} />}
                ListFooterComponent={
                    syncHistory.length > 0 ? (
                        <View style={s.historySection}>
                            <Text style={s.sectionTitle}>Recent Global Syncs</Text>
                            {syncHistory.slice(0, 5).map((log, i) => (
                                <View key={log.platform + log.business_id + i} style={s.historyCard}>
                                    <View style={[s.platformDot, { backgroundColor: log.platform === 'google' ? '#4285F4' : '#D32323' }]} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.historyName}>{log.business_name}</Text>
                                        <Text style={s.historyMeta}>
                                            {log.new_reviews} new • {new Date(log.last_synced_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                                        </Text>
                                    </View>
                                    <Ionicons name="checkmark-circle" size={16} color={colors.accent.green} />
                                </View>
                            ))}
                        </View>
                    ) : null
                }
            />
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    content: { padding: spacing.md, paddingBottom: 60 },

    header: { marginBottom: spacing.lg },
    title: { color: colors.text.primary, fontSize: fonts.sizes.xxl, fontWeight: '700' },
    subtitle: { color: colors.text.secondary, fontSize: fonts.sizes.md, marginTop: 4 },

    form: {
        backgroundColor: colors.bg.card,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        gap: spacing.md,
        marginBottom: spacing.xl,
    },
    inputGroup: { gap: 6 },
    label: { color: colors.text.secondary, fontSize: fonts.sizes.sm, fontWeight: '600' },
    input: {
        height: 48,
        backgroundColor: colors.bg.input,
        borderRadius: radius.md,
        color: colors.text.primary,
        paddingHorizontal: spacing.md,
        fontSize: fonts.sizes.md,
        borderWidth: 1,
        borderColor: colors.border.default,
    },
    searchBtn: {
        height: 48,
        backgroundColor: colors.accent.gold,
        borderRadius: radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        marginTop: spacing.xs,
    },
    searchBtnText: { color: colors.bg.primary, fontSize: fonts.sizes.md, fontWeight: '700' },

    errorText: { color: colors.accent.red, fontSize: fonts.sizes.sm, marginBottom: spacing.md, textAlign: 'center' },

    resultsSection: { gap: spacing.lg, marginBottom: spacing.xl },
    platformSection: { gap: spacing.sm, marginTop: spacing.lg },
    platformHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
    platformTitle: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '700' },

    bizCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        backgroundColor: colors.bg.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        gap: spacing.sm,
        marginBottom: spacing.sm,
    },
    bizInfo: { flex: 1 },
    bizName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    bizAddr: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },
    bizMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.text.muted, opacity: 0.3 },
    bizRating: { color: colors.accent.gold, fontSize: fonts.sizes.xs, fontWeight: '600' },
    bizReviews: { color: colors.text.muted, fontSize: fonts.sizes.xs },
    bizDistance: { color: colors.text.muted, fontSize: fonts.sizes.xs },

    syncBtn: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.bg.secondary,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border.default,
    },
    syncBtnText: { color: colors.text.primary, fontSize: fonts.sizes.sm, fontWeight: '600' },

    platBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radius.full,
    },
    platText: { fontSize: 10, fontWeight: '700' },

    emptyPlatform: {
        padding: spacing.md,
        alignItems: 'center',
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: colors.border.subtle,
        borderRadius: radius.md,
    },
    emptyPlatformText: { color: colors.text.muted, fontSize: fonts.sizes.xs },

    historySection: { gap: spacing.sm, marginTop: spacing.xl },
    sectionTitle: { color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '700', textTransform: 'uppercase' },
    historyCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: spacing.md,
        backgroundColor: colors.bg.card,
        borderRadius: radius.md,
        gap: spacing.sm,
    },
    platformDot: { width: 8, height: 8, borderRadius: 4 },
    historyName: { color: colors.text.primary, fontSize: fonts.sizes.sm, fontWeight: '600' },
    historyMeta: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 1 },
});
