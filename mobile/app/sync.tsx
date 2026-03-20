import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { 
    searchBusiness, 
    syncApifyReviews, 
    fetchSyncStatus, 
    fetchSyncProgress,
    fetchLatestSyncResults,
    cancelSync,
    cancelAllSyncs,
    autocompleteBusiness,
    getActiveRestaurantId,
    UnifiedBusiness,
    AutocompleteSuggestion,
} from '@/lib/api';
import { calculateDistance } from '../lib/geo';
import { SyncConfirmOverlay } from '@/components/SyncConfirmOverlay';
import { SyncProgressOverlay } from '@/components/SyncProgressOverlay';
import { SyncReportOverlay } from '@/components/SyncReportOverlay';

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
    const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [pendingSync, setPendingSync] = useState<UnifiedBusiness | null>(null);

    // Report state
    const [showReport, setShowReport] = useState(false);
    const [syncResults, setSyncResults] = useState<any[]>([]);

    // Progress state
    const [showProgress, setShowProgress] = useState(false);
    const [progressPercent, setProgressPercent] = useState(0);
    const [syncStatusText, setSyncStatusText] = useState('Starting...');
    const [processedCount, setProcessedCount] = useState(0);
    const [totalValidCount, setTotalValidCount] = useState(0);
    const [estRemaining, setEstRemaining] = useState<number | undefined>(undefined);

    // Polling ref
    const pollIntervalRef = React.useRef<any>(null);
    const abortControllerRef = React.useRef<AbortController | null>(null);

    // Debounce ref for search-as-you-type
    const debounceRef = useRef<any>(null);

    // Fetch GPS once on mount
    useEffect(() => {
        loadStatus();
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const pos = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    console.log(`[Sync] GPS cached: ${pos.coords.latitude}, ${pos.coords.longitude}`);
                }
            } catch (e) {
                console.warn('[Sync] GPS unavailable:', e);
            }
        })();
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    // Debounced autocomplete when name changes (lightweight, no full search)
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!name.trim() || name.trim().length < 3) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            try {
                const data = await autocompleteBusiness(
                    name.trim(),
                    userCoords?.lat,
                    userCoords?.lng,
                );
                setSuggestions(data);
                setShowSuggestions(data.length > 0);
            } catch (e) {
                console.warn('[Autocomplete] Error:', e);
            }
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [name]);

    const stopPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    };

    const startPolling = (restaurantId: string) => {
        stopPolling();
        pollIntervalRef.current = setInterval(async () => {
            try {
                const prog = await fetchSyncProgress(restaurantId);
                if (prog && prog.active) {
                    // Only accept backend progress if it's HIGHER (never go backwards)
                    setProgressPercent(prev => Math.max(prev, prog.percent || 0));
                    setSyncStatusText(prog.status || '');
                    setProcessedCount(prog.processed_count || 0);
                    setTotalValidCount(prog.total_count || 0);
                    setEstRemaining(prog.estimated_seconds_remaining);

                    if (!prog.active && prog.percent === 100) {
                        stopPolling();
                    }
                }
            } catch (e) {
                // Silently ignore polling errors (timeouts during heavy backend work)
            }
        }, 2000);
    };

    const handleCancelSync = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        stopPolling();
        setShowProgress(false);
        setSyncing({});
        // Cancel ALL active syncs on the backend — we don't know the new restaurant's ID
        try {
            await cancelAllSyncs();
        } catch (e) {
            console.warn('Backend cancel-all failed:', e);
        }
    };

    const loadStatus = async () => {
        try {
            const status = await fetchSyncStatus();
            setSyncHistory(status);
        } catch (e) { }
    };

    const handleSearch = async (overrideName?: string) => {
        const searchName = overrideName || name;
        if (!searchName.trim()) return;
        setSearching(true);
        setError(null);

        try {
            let lat: number | null = userCoords?.lat ?? null;
            let lng: number | null = userCoords?.lng ?? null;

            // Use location text override if provided, otherwise use cached GPS
            if (location.trim()) {
                lat = null;
                lng = null;
            }

            const data = await searchBusiness(searchName.trim(), location.trim(), lat, lng);

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

    const handleSync = (item: UnifiedBusiness) => {
        setPendingSync(item);
        setShowConfirm(true);
    };

    const performSync = async () => {
        if (!pendingSync) return;
        const item = pendingSync;
        setShowConfirm(false);
        setPendingSync(null);

        const key = item.id;
        setSyncing(prev => ({ ...prev, [key]: true }));
        setShowProgress(true);
        setProgressPercent(0);
        setSyncStatusText('Initializing sync...');
        
        abortControllerRef.current = new AbortController();

        // Start polling for backend progress if we have a restaurant ID
        const activeId = await getActiveRestaurantId();
        if (activeId) {
            startPolling(activeId);
        }

        // Simulated progress: Smoothly ticks up while waiting for the actual sync response.
        // This guarantees visible progress even for brand-new restaurants where the
        // backend restaurant_id isn't known yet (polling returns idle/0%).
        const SYNC_PHASES = [
            { pct: 5,  at: 2,   msg: 'Connecting to platforms...' },
            { pct: 10, at: 5,   msg: 'Checking live review counts...' },
            { pct: 15, at: 10,  msg: 'Scraping reviews...' },
            { pct: 25, at: 20,  msg: 'Scraping reviews...' },
            { pct: 35, at: 40,  msg: 'Downloading review data...' },
            { pct: 45, at: 60,  msg: 'Processing reviews...' },
            { pct: 55, at: 90,  msg: 'Ingesting reviews into database...' },
            { pct: 65, at: 120, msg: 'Running sentiment analysis...' },
            { pct: 75, at: 180, msg: 'Analyzing sentiment batches...' },
            { pct: 82, at: 240, msg: 'Almost there...' },
            { pct: 88, at: 300, msg: 'Finalizing sync...' },
        ];
        const startTime = Date.now();
        const simIntervalRef = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            // Find the highest phase we've passed
            let simPct = 0;
            let simMsg = 'Initializing sync...';
            for (const phase of SYNC_PHASES) {
                if (elapsed >= phase.at) {
                    simPct = phase.pct;
                    simMsg = phase.msg;
                }
            }
            // Only update if simulated progress is AHEAD of what polling returned
            setProgressPercent(prev => Math.max(prev, simPct));
            setSyncStatusText(prev => {
                // Don't overwrite real backend status if polling is working
                if (prev.includes('batch') || prev.includes('Ingesting')) return prev;
                return simMsg;
            });
        }, 1000);

        try {
            // Run platform syncs SEQUENTIALLY to prevent duplicate restaurant creation.
            // The first call creates the restaurant and returns its ID as tracking_id.
            // The second call reuses that ID.
            let primaryTrackingId: string | null = null;
            const syncResults: any[] = [];

            if (item.google) {
                const res = await syncApifyReviews('google', item.google.url || item.google.id, item.google.name, item.google.address, true, abortControllerRef.current.signal);
                syncResults.push(res);
                if (res?.tracking_id) primaryTrackingId = res.tracking_id;
            }
            if (item.yelp) {
                const res = await syncApifyReviews('yelp', item.yelp.url || item.yelp.id, item.yelp.name, item.yelp.address, true, abortControllerRef.current.signal, primaryTrackingId ?? undefined);
                syncResults.push(res);
                if (!primaryTrackingId && res?.tracking_id) primaryTrackingId = res.tracking_id;
            }


            if (primaryTrackingId) {
                // Also start the existing polling mechanism with the tracking ID
                startPolling(primaryTrackingId);
                
                // Poll until complete
                const maxWait = 600; // 10 minutes max
                let waited = 0;
                let lastProgress: any = null;
                while (waited < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    waited += 3;
                    try {
                        const progress = await fetchSyncProgress(primaryTrackingId);
                        lastProgress = progress;
                        if (progress?.percent >= 100) {
                            clearInterval(simIntervalRef);
                            setProgressPercent(100);
                            setSyncStatusText('Sync Complete!');
                            loadStatus();
                            break;
                        }
                        if (progress?.status?.startsWith('Sync failed')) {
                            throw new Error(progress.status);
                        }
                        // Update from real backend progress
                        if (progress?.percent > 0) {
                            setProgressPercent(prev => Math.max(prev, progress.percent));
                            setSyncStatusText(progress.status || 'Syncing...');
                        }
                    } catch (pollErr) {
                        // Polling failed — don't crash, just continue with simulated progress
                    }
                }

                // Fetch real per-platform results from sync_logs DB
                try {
                    const dbResults = await fetchLatestSyncResults(primaryTrackingId);
                    if (dbResults && dbResults.length > 0) {
                        setSyncResults(dbResults);
                        setShowProgress(false);
                        setShowReport(true);
                    }
                } catch (e) {
                    console.warn('Could not fetch sync results:', e);
                }
            } else {
                // No restaurant ID to poll — just wait a bit with simulated progress
                await new Promise(resolve => setTimeout(resolve, 30000));
                clearInterval(simIntervalRef);
                setProgressPercent(100);
                setSyncStatusText('Sync Complete!');
            }
        } catch (e: any) {
            clearInterval(simIntervalRef);
            if (e.name === 'AbortError') return;
            console.error('[Sync] Error during sync:', e);
            // Auto-dismiss the overlay and show an alert
            setShowProgress(false);
            setSyncStatusText('');
            setProgressPercent(0);
            const msg = e.message === 'Failed to fetch' 
                ? 'Could not reach the server. Make sure the backend is running.'
                : (e.message || 'Sync failed unexpectedly.');
            setTimeout(() => {
                if (typeof window !== 'undefined') {
                    window.alert(`⚠️ Sync Error\n\n${msg}`);
                }
            }, 100);
        } finally {
            clearInterval(simIntervalRef);
            stopPolling();
            setSyncing(prev => ({ ...prev, [key]: false }));
            abortControllerRef.current = null;
        }
    };

    const renderBizCard = ({ item }: { item: UnifiedBusiness }) => {
        const lastSyncMeta = item.google?.last_sync || item.yelp?.last_sync;
        const lastSyncText = lastSyncMeta?.ago;
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
                                <Text style={[s.platText, { color: '#4285F4' }]}>Google • {item.google.review_count}</Text>
                            </View>
                        )}
                        {item.yelp && (
                            <View style={[s.platBadge, { backgroundColor: '#FF1A1A20' }]}>
                                <Ionicons name="star" size={10} color="#FF1A1A" />
                                <Text style={[s.platText, { color: '#FF1A1A' }]}>Yelp • {item.yelp.review_count}</Text>
                            </View>
                        )}
                    </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {lastSyncText && !isSyncing && (
                        <Text style={s.cooldownText}>Synced {lastSyncText}</Text>
                    )}
                    <TouchableOpacity
                        style={[s.syncBtn, isSyncing && { opacity: 0.6 }]}
                        disabled={isSyncing}
                        onPress={() => handleSync(item)}
                    >
                        {isSyncing ? (
                            <ActivityIndicator size="small" color={colors.text.primary} />
                        ) : (
                            <Text style={s.syncBtnText}>Sync</Text>
                        )}
                    </TouchableOpacity>
                </View>
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
                                    onChangeText={(text) => {
                                        setName(text);
                                        if (!text.trim()) {
                                            setSuggestions([]);
                                            setShowSuggestions(false);
                                        }
                                    }}
                                />
                                {showSuggestions && suggestions.length > 0 && (
                                    <View style={s.suggestionsDropdown}>
                                        {suggestions.map((s_item, idx) => (
                                            <TouchableOpacity
                                                key={`${s_item.source}-${idx}`}
                                                style={[s.suggestionItem, idx > 0 && s.suggestionBorder]}
                                                onPress={() => {
                                                    setName(s_item.name);
                                                    setShowSuggestions(false);
                                                    setSuggestions([]);
                                                    // Auto-trigger search with the selected name
                                                    handleSearch(s_item.name);
                                                }}
                                            >
                                                <Ionicons
                                                    name="search-outline"
                                                    size={14}
                                                    color={colors.text.muted}
                                                    style={{ marginRight: 8 }}
                                                />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={s.suggestionName} numberOfLines={1}>{s_item.name}</Text>
                                                    {s_item.description ? (
                                                        <Text style={s.suggestionDesc} numberOfLines={1}>{s_item.description}</Text>
                                                    ) : null}
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                )}
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
                                onPress={() => handleSearch()}
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

                        {/* Empty results state */}
                        {results && results.length === 0 && !searching && (
                            <View style={s.emptyState}>
                                <Ionicons name="search-outline" size={40} color={colors.text.muted} />
                                <Text style={s.emptyTitle}>No Restaurants Found</Text>
                                <Text style={s.emptySubtitle}>
                                    Try a different business name, or add a city/zip in the Location field.
                                </Text>
                            </View>
                        )}
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
            <SyncConfirmOverlay
                visible={showConfirm}
                title="Smart Sync"
                message="This will fetch and update the latest reviews keep your counts accurate. Continue?"
                onConfirm={performSync}
                onCancel={() => setShowConfirm(false)}
            />

            <SyncProgressOverlay
                visible={showProgress}
                percent={progressPercent}
                status={syncStatusText}
                processedCount={processedCount}
                totalCount={totalValidCount}
                estimatedSecondsRemaining={estRemaining}
                onCancel={handleCancelSync}
                onClose={() => {
                    // Just dismiss the overlay — do NOT call cancelAllSyncs
                    setShowProgress(false);
                    setSyncStatusText('');
                    setProgressPercent(0);
                    loadStatus();
                }}
            />

            <SyncReportOverlay
                visible={showReport}
                results={syncResults}
                onClose={() => {
                    setShowReport(false);
                    loadStatus();
                }}
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
        backgroundColor: colors.accent.gold,
        borderRadius: radius.sm,
        shadowColor: colors.accent.gold,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    syncBtnText: { color: colors.bg.primary, fontSize: fonts.sizes.sm, fontWeight: '700' },

    cooldownText: { color: colors.text.muted, fontSize: 9, marginBottom: 2 },
    readyText: { color: colors.accent.gold, fontSize: 10, fontWeight: '700', marginBottom: 2 },

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

    // Autocomplete dropdown
    suggestionsDropdown: {
        backgroundColor: colors.bg.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        marginTop: 4,
        overflow: 'hidden' as const,
    },
    suggestionItem: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        paddingVertical: 10,
        paddingHorizontal: spacing.sm,
    },
    suggestionBorder: {
        borderTopWidth: 1,
        borderTopColor: colors.border.subtle,
    },
    suggestionName: {
        color: colors.text.primary,
        fontSize: fonts.sizes.sm,
        fontWeight: '500' as const,
    },
    suggestionDesc: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        marginTop: 1,
    },

    // Empty results state
    emptyState: {
        alignItems: 'center',
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
    },
    emptyTitle: {
        color: colors.text.primary,
        fontSize: fonts.sizes.lg,
        fontWeight: '700',
    },
    emptySubtitle: {
        color: colors.text.muted,
        fontSize: fonts.sizes.sm,
        textAlign: 'center',
        lineHeight: 20,
    },
});
