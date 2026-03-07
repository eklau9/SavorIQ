import React, { useState, useCallback } from 'react';
import {
    View, Text, FlatList, StyleSheet, RefreshControl,
    ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import { fetchGuests, Guest } from '@/lib/api';
import NoRestaurantSelected from '@/components/NoRestaurantSelected';

const tierColors: Record<string, string> = {
    vip: colors.accent.gold,
    regular: colors.accent.green,
    new: colors.accent.gold,
    slipping: colors.accent.red,
};

export default function GuestsScreen() {
    const { activeId, loading: contextLoading } = useRestaurant();
    const { guests: globalGuests, refreshAll, loading: dataLoading } = useData();
    const router = useRouter();
    const [guests, setGuests] = useState<Guest[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [filterTier, setFilterTier] = useState<string | undefined>();
    const [sortBy, setSortBy] = useState<'recent' | 'rating' | 'reviews'>('recent');

    const loadData = useCallback(async () => {
        if (!activeId) {
            setLoading(false);
            setRefreshing(false);
            return;
        }

        // If no filter, use global data instantly
        if (!filterTier) {
            setGuests(globalGuests);
            setLoading(false);
            setRefreshing(false);
            return;
        }

        setLoading(true);
        try {
            const data = await fetchGuests({
                tier: filterTier,
                sort_by: sortBy
            });
            setGuests(data);
        } catch (e) {
            console.error('Guests load error:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [activeId, filterTier, sortBy, globalGuests]);

    useFocusEffect(
        useCallback(() => {
            if (activeId) {
                if (!filterTier && sortBy === 'recent') {
                    refreshAll();
                } else {
                    loadData();
                }
            }
        }, [activeId, filterTier, sortBy, refreshAll, loadData])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        if (!filterTier) {
            await refreshAll();
        } else {
            await loadData();
        }
        setRefreshing(false);
    };

    const isLoading = contextLoading || (loading && guests.length === 0) || (dataLoading && !filterTier && globalGuests.length === 0);
    const displayGuests = filterTier ? guests : globalGuests;

    const renderGuest = ({ item }: { item: Guest }) => (
        <TouchableOpacity
            style={s.guestCard}
            onPress={() => router.push(`/guest/${item.id}`)}
            activeOpacity={0.7}
        >
            <View style={s.avatarCircle}>
                <Text style={s.avatarText}>{item.name?.charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View style={s.guestInfo}>
                <Text style={s.guestName}>{item.name}</Text>
                <Text style={s.guestMeta}>
                    {item.visit_count || 0} review{item.visit_count !== 1 ? 's' : ''}
                    {item.avg_rating ? ` · ★ ${item.avg_rating.toFixed(1)}` : ''}
                </Text>
            </View>
            <View style={[s.tierBadge, { backgroundColor: (tierColors[item.tier] || colors.text.muted) + '20' }]}>
                <Text style={[s.tierText, { color: tierColors[item.tier] || colors.text.muted }]}>
                    {item.tier.toUpperCase()}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </TouchableOpacity>
    );

    return (
        <View style={s.container}>
            {!activeId ? (
                <NoRestaurantSelected />
            ) : (
                <>
                    {/* Tier Filters */}
                    <View style={s.filterContainer}>
                        <View style={s.filterRow}>
                            {['all', 'vip', 'regular', 'new', 'slipping'].map((t) => (
                                <TouchableOpacity
                                    key={t}
                                    style={[s.filterChip, filterTier === (t === 'all' ? undefined : t) && s.filterChipActive]}
                                    onPress={() => setFilterTier(t === 'all' ? undefined : t)}
                                >
                                    <Text style={[s.filterChipText,
                                    filterTier === (t === 'all' ? undefined : t) && s.filterChipTextActive,
                                    ]}>
                                        {t.charAt(0).toUpperCase() + t.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <View style={s.sortRow}>
                            <Ionicons name="swap-vertical" size={14} color={colors.text.muted} style={{ marginRight: 4 }} />
                            <Text style={s.sortLabel}>Sort by:</Text>
                            {(['recent', 'rating', 'reviews'] as const).map((s_opt) => (
                                <TouchableOpacity
                                    key={s_opt}
                                    style={[s.sortChip, sortBy === s_opt && s.sortChipActive]}
                                    onPress={() => setSortBy(s_opt)}
                                >
                                    <Text style={[s.sortChipText, sortBy === s_opt && s.sortChipTextActive]}>
                                        {s_opt.charAt(0).toUpperCase() + s_opt.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <Text style={s.countText}>{displayGuests.length} guests</Text>

                    {isLoading ? (
                        <View style={s.center}>
                            <ActivityIndicator size="large" color={colors.accent.gold} />
                        </View>
                    ) : (
                        <FlatList
                            data={displayGuests}
                            renderItem={renderGuest}
                            keyExtractor={(item) => String(item.id)}
                            contentContainerStyle={s.list}
                            refreshControl={
                                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.gold} />
                            }
                            ListEmptyComponent={
                                <View style={s.center}>
                                    <Text style={s.emptyText}>No guests found</Text>
                                </View>
                            }
                        />
                    )}
                </>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
    list: { padding: spacing.md, paddingBottom: 40 },

    filterContainer: {
        padding: spacing.md, paddingBottom: 0, gap: spacing.sm,
    },
    filterRow: {
        flexDirection: 'row', gap: spacing.xs,
    },
    filterChip: {
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
        backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.subtle,
    },
    filterChipActive: { backgroundColor: colors.accent.gold + '20', borderColor: colors.accent.gold },
    filterChipText: { color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '500' },
    filterChipTextActive: { color: colors.accent.gold },

    sortRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        marginTop: spacing.xs,
    },
    sortLabel: { color: colors.text.muted, fontSize: 12, marginRight: 4 },
    sortChip: {
        paddingHorizontal: 8, paddingVertical: 4,
    },
    sortChipActive: {
        borderBottomWidth: 2, borderBottomColor: colors.accent.gold,
    },
    sortChipText: { color: colors.text.secondary, fontSize: 12 },
    sortChipTextActive: { color: colors.accent.gold, fontWeight: '600' },

    countText: {
        color: colors.text.muted, fontSize: fonts.sizes.xs,
        paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    },

    guestCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    avatarCircle: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: colors.accent.gold + '20',
        justifyContent: 'center', alignItems: 'center',
    },
    avatarText: { color: colors.accent.gold, fontSize: fonts.sizes.lg, fontWeight: '700' },
    guestInfo: { flex: 1 },
    guestName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    guestMeta: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },
    tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
    tierText: { fontSize: fonts.sizes.xs, fontWeight: '700', letterSpacing: 0.5 },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md },
});
