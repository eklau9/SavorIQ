import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { searchBusiness, syncApifyReviews, fetchSyncStatus } from '@/lib/api';

export default function SyncScreen() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [syncing, setSyncing] = useState<Record<string, boolean>>({});
    const [syncHistory, setSyncHistory] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

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
            const data = await searchBusiness(name.trim(), location.trim());
            setResults(data);
        } catch (e: any) {
            setError(e.message || 'Search failed');
        } finally {
            setSearching(false);
        }
    };

    const handleSync = async (platform: string, businessId: string, businessName: string, businessUrl: string) => {
        const identifier = businessUrl || businessId;
        const key = `${platform}:${identifier}`;
        setSyncing(prev => ({ ...prev, [key]: true }));
        try {
            await syncApifyReviews(platform, identifier, businessName);
            loadStatus();
            alert(`Sync started for ${businessName}. This may take a minute.`);
        } catch (e: any) {
            alert(`Sync error: ${e.message}`);
        } finally {
            setSyncing(prev => ({ ...prev, [key]: false }));
        }
    };

    return (
        <View style={s.container}>
            <Stack.Screen options={{ title: 'Review Sync', headerTitleStyle: { fontWeight: '700' } }} />

            <ScrollView contentContainerStyle={s.content}>
                <View style={s.header}>
                    <Text style={s.title}>Add New Restaurant</Text>
                    <Text style={s.subtitle}>Search Google & Yelp to fetch customer reviews</Text>
                </View>

                {/* Search Form */}
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

                {/* Results */}
                {results && (
                    <View style={s.resultsSection}>
                        {[
                            { title: 'Google Maps', key: 'google', icon: 'logo-google' as any, color: '#4285F4' },
                            { title: 'Yelp', key: 'yelp', icon: 'logo-yelp' as any, color: '#D32323' }
                        ].map(platform => (
                            <View key={platform.key} style={s.platformSection}>
                                <View style={s.platformHeader}>
                                    <Ionicons name={platform.icon} size={18} color={platform.color} />
                                    <Text style={s.platformTitle}>{platform.title}</Text>
                                </View>

                                {results[platform.key]?.length > 0 ? (
                                    results[platform.key].map((biz: any) => (
                                        <View key={biz.id} style={s.bizCard}>
                                            <View style={s.bizInfo}>
                                                <Text style={s.bizName}>{biz.name}</Text>
                                                <Text style={s.bizAddr} numberOfLines={1}>{biz.address}</Text>
                                                <View style={s.bizMeta}>
                                                    <Text style={s.bizRating}>⭐ {biz.rating}</Text>
                                                    <Text style={s.bizReviews}>{biz.review_count} reviews</Text>
                                                </View>
                                            </View>
                                            <TouchableOpacity
                                                style={[s.syncBtn, syncing[`${platform.key}:${biz.place_url || biz.url || biz.id}`] && { opacity: 0.6 }]}
                                                disabled={syncing[`${platform.key}:${biz.place_url || biz.url || biz.id}`] || biz.last_sync?.on_cooldown}
                                                onPress={() => handleSync(platform.key, biz.id, biz.name, biz.place_url || biz.url)}
                                            >
                                                {syncing[`${platform.key}:${biz.place_url || biz.url || biz.id}`] ? (
                                                    <ActivityIndicator size="small" color={colors.text.primary} />
                                                ) : biz.last_sync?.on_cooldown ? (
                                                    <Text style={s.syncBtnText}>⏳ {biz.last_sync.ago}</Text>
                                                ) : (
                                                    <Text style={s.syncBtnText}>Sync</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    ))
                                ) : (
                                    <View style={s.emptyPlatform}>
                                        <Text style={s.emptyPlatformText}>No results found on {platform.title}</Text>
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}

                {/* Sync History */}
                {syncHistory.length > 0 && (
                    <View style={s.historySection}>
                        <Text style={s.sectionTitle}>Sync History</Text>
                        {syncHistory.slice(0, 5).map((log, i) => (
                            <View key={i} style={s.historyCard}>
                                <View style={[s.platformDot, { backgroundColor: log.platform === 'google' ? '#4285F4' : '#D32323' }]} />
                                <View style={{ flex: 1 }}>
                                    <Text style={s.historyName}>{log.business_name}</Text>
                                    <Text style={s.historyMeta}>
                                        {log.new_reviews} new • {new Date(log.last_synced_at).toLocaleDateString()}
                                    </Text>
                                </View>
                                <Ionicons name="checkmark-circle" size={16} color={colors.accent.green} />
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
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
    platformSection: { gap: spacing.sm },
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
    },
    bizInfo: { flex: 1 },
    bizName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    bizAddr: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },
    bizMeta: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
    bizRating: { color: colors.accent.gold, fontSize: fonts.sizes.xs, fontWeight: '600' },
    bizReviews: { color: colors.text.muted, fontSize: fonts.sizes.xs },

    syncBtn: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.bg.secondary,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border.default,
    },
    syncBtnText: { color: colors.text.primary, fontSize: fonts.sizes.sm, fontWeight: '600' },

    emptyPlatform: {
        padding: spacing.md,
        alignItems: 'center',
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: colors.border.subtle,
        borderRadius: radius.md,
    },
    emptyPlatformText: { color: colors.text.muted, fontSize: fonts.sizes.xs },

    historySection: { gap: spacing.sm },
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
