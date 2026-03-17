import {
    View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setApiBase, getApiBase, resetAndSync, fetchSyncProgress, cancelSync } from '@/lib/api';
import { useState, useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { SyncProgressOverlay } from '@/components/SyncProgressOverlay';
import { SyncReportOverlay } from '@/components/SyncReportOverlay';
import { SyncConfirmOverlay } from '@/components/SyncConfirmOverlay';
import { Stack } from 'expo-router';

export default function MoreScreen() {
    const router = useRouter();
    const { restaurants, activeId, activeName, switchRestaurant, loadRestaurants } = useRestaurant();
    const { refreshAll } = useData();

    const [currentApi, setCurrentApi] = useState<string>('Loading...');
    const [syncing, setSyncing] = useState(false);
    
    // Progress state
    const [showProgress, setShowProgress] = useState(false);
    const [progressPercent, setProgressPercent] = useState(0);
    const [syncStatus, setSyncStatus] = useState('Starting...');
    const [processedCount, setProcessedCount] = useState(0);
    const [totalValidCount, setTotalValidCount] = useState(0);
    const [estRemaining, setEstRemaining] = useState<number | undefined>(undefined);
    
    // Report state
    const [showReport, setShowReport] = useState(false);
    const [syncResults, setSyncResults] = useState<any[]>([]);

    // Confirmation state
    const [showConfirm, setShowConfirm] = useState(false);
    
    // Cancellation handler
    const abortControllerRef = useRef<AbortController | null>(null);
    const pollIntervalRef = useRef<any>(null);

    useEffect(() => {
        (async () => {
            const api = await getApiBase();
            setCurrentApi(api);
        })();
        
        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, []);

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
                if (prog) {
                    setProgressPercent(prog.percent || 0);
                    setSyncStatus(prog.status || '');
                    setEstRemaining(prog.estimated_seconds_remaining);
                   if (prog.status) setSyncStatus(prog.status);
                if (prog.processed_count !== undefined) setProcessedCount(prog.processed_count);
                if (prog.total_count !== undefined) setTotalValidCount(prog.total_count);
                if (prog.estimated_seconds_remaining !== undefined) {
                    setEstRemaining(prog.estimated_seconds_remaining);
                }
    
                    if (!prog.active && prog.percent === 100) {
                        stopPolling();
                    }
                }
            } catch (e) {
                console.error('Polling error:', e);
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
        setSyncing(false);
        
        if (activeId) {
            try {
                await cancelSync(activeId);
            } catch (e) {
                console.warn('Backend cancel failed:', e);
            }
        }
    };

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
        setShowConfirm(true);
    };

    const performActualSync = async () => {
        setShowConfirm(false);
        setSyncing(true);
        setShowProgress(true);
        setProgressPercent(0);
        setSyncStatus('Starting sync...');
        setEstRemaining(undefined);
        
        abortControllerRef.current = new AbortController();
        startPolling(activeId!);

        try {
            const res = await resetAndSync(activeId!, abortControllerRef.current.signal);
            
            // Sync is over. Hide progress IMMEDIATELY so the user isn't stuck on the 100% bar.
            setSyncing(false);
            setShowProgress(false);
            stopPolling();
            
            if (res.results) {
                setSyncResults(res.results);
                setShowProgress(false); // Ensure progress hides before report shows
                setShowReport(true);
                // Background refresh: update dashboard counts without blocking the report UI
                refreshAll();
                loadRestaurants();
            } else if (res.status === 'success') {
                setSyncResults([{ platform: 'sync', status: 'synced', new_ingested: 0 }]);
                setShowProgress(false); // Ensure progress hides before report shows
                setShowReport(true);
                refreshAll();
                loadRestaurants();
            } else if (res.status === 'cancelled') {
                console.log('Sync cancelled report received');
            } else {
                throw new Error(res.message || 'Sync failed.');
            }
        } catch (e: any) {
            if (e.name === 'AbortError') return; // Handled in handleCancelSync
            
            const msg = e.message || 'Please wait before syncing again.';
            if (typeof window !== 'undefined') {
                window.alert(`⚠️ Sync Limited\n\n${msg}`);
            } else {
                Alert.alert('Sync Limited', msg);
            }
        } finally {
            setSyncing(false);
            setShowProgress(false);
            stopPolling();
            abortControllerRef.current = null;
        }
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
            <Stack.Screen options={{ headerShown: false }} />
            
            {/* Premium Header */}
            <View style={s.headerRow}>
                <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                            <Text style={[s.welcomeText, { color: colors.accent.gold }]}>
                                SavorIQ
                            </Text>
                        </View>
                        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
                            {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                    </View>
                    <Text style={[s.activeLocText, { fontSize: 32, lineHeight: 38, letterSpacing: -0.5, fontWeight: '800' }]}>
                        More
                    </Text>
                </View>
            </View>

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

            {/* Operator Tools (Dev Only) */}
            {__DEV__ && (
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Operator Tools</Text>
                    <MenuItem
                        icon="construct"
                        label="Admin Dashboard"
                        subtitle="Monitor API Quotas & System Status"
                        onPress={() => Linking.openURL('http://localhost:5174')}
                    />
                </View>
            )}

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
            
            <SyncProgressOverlay
                visible={syncing}
                percent={progressPercent}
                status={syncStatus}
                processedCount={processedCount}
                totalCount={totalValidCount}
                estimatedSecondsRemaining={estRemaining}
                onCancel={handleCancelSync}
            />

            <SyncReportOverlay
                visible={showReport}
                results={syncResults}
                onClose={() => setShowReport(false)}
            />

            <SyncConfirmOverlay
                visible={showConfirm}
                title="Smart Sync"
                message="This will fetch and update the latest reviews keep your counts accurate. Continue?"
                onConfirm={performActualSync}
                onCancel={() => setShowConfirm(false)}
            />
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
    content: { padding: spacing.md, paddingTop: 0, paddingBottom: 40 },

    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 32,
        paddingHorizontal: spacing.xs,
        marginBottom: spacing.md,
    },
    welcomeText: {
        color: colors.text.secondary,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    activeLocText: {
        color: colors.text.primary,
        fontSize: 32,
        fontWeight: '800',
    },
    bookingsRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginTop: spacing.md,
    },

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
