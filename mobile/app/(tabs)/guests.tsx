import React, { useState, useCallback, useEffect } from 'react';
import {
    View, Text, FlatList, StyleSheet, ScrollView,
    ActivityIndicator, TouchableOpacity, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
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

const ratingColor = (rating: number) => {
    if (rating <= 2) return colors.accent.red;
    if (rating <= 3.5) return colors.accent.gold;
    return colors.accent.green;
};

export default function GuestsScreen() {
    const { activeId, loading: contextLoading } = useRestaurant();
    const { guests: globalGuests, refreshAll, loading: dataLoading, timeRange, setTimeRange } = useData();
    const router = useRouter();
    const [guests, setGuests] = useState<Guest[]>([]);
    const [filterTier, setFilterTier] = useState<string | undefined>();
    const [sortField, setSortField] = useState<'date' | 'rating'>('date');
    const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
    const [searchText, setSearchText] = useState('');

    const sortDescription = sortField === 'date'
        ? (sortDir === 'desc' ? 'Newest first' : 'Oldest first')
        : (sortDir === 'desc' ? 'Highest rated' : 'Lowest rated');

    // Local Filtering Logic (Instant Feedback)
    useEffect(() => {
        if (!activeId || globalGuests.length === 0) return;

        const now = new Date();
        const filtered = globalGuests.filter(g => {
            const matchesTier = !filterTier || g.tier === filterTier;
            const matchesSearch = !searchText || g.name.toLowerCase().includes(searchText.toLowerCase());
            const matchesTime = !timeRange || (g.last_visit && (now.getTime() - new Date(g.last_visit).getTime()) <= timeRange * 86400000);
            return matchesTier && matchesSearch && matchesTime;
        });

        const sorted = [...filtered].sort((a, b) => {
            if (sortField === 'rating') {
                return sortDir === 'desc'
                    ? (b.avg_rating || 0) - (a.avg_rating || 0)
                    : (a.avg_rating || 0) - (b.avg_rating || 0);
            }
            const aDate = new Date(a.last_visit || a.created_at).getTime();
            const bDate = new Date(b.last_visit || b.created_at).getTime();
            return sortDir === 'desc' ? bDate - aDate : aDate - bDate;
        });

        setGuests(sorted);
    }, [activeId, globalGuests, filterTier, sortField, sortDir, searchText, timeRange]);

    const isLoading = contextLoading || (dataLoading && !filterTier && globalGuests.length === 0);
    const displayGuests = (filterTier || searchText || timeRange) ? guests : globalGuests;

    const renderGuest = ({ item }: { item: Guest }) => (
        <TouchableOpacity
            style={s.guestCard}
            onPress={() => router.push({
                pathname: '/guest/[id]' as any,
                params: {
                    id: item.id,
                    name: item.name,
                    tier: item.tier,
                    avg_rating: String(item.avg_rating ?? ''),
                    visit_count: String(item.visit_count ?? 0),
                },
            })}
            activeOpacity={0.7}
        >
            <View style={s.avatarCircle}>
                <Text style={s.avatarText}>{item.name?.charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View style={s.guestInfo}>
                <Text style={s.guestName}>{item.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={s.guestMeta}>
                        {item.visit_count || 0} review{item.visit_count !== 1 ? 's' : ''}
                        {item.avg_rating ? ' · ' : ''}
                    </Text>
                    {item.avg_rating ? (
                        <Text style={[s.guestMeta, { color: ratingColor(item.avg_rating) }]}>
                            ★ {item.avg_rating.toFixed(1)}
                        </Text>
                    ) : null}
                </View>
            </View>
            {item.tier !== 'new' && (
                <View style={[s.tierBadge, { backgroundColor: (tierColors[item.tier] || colors.text.muted) + '20' }]}>
                    <Text style={[s.tierText, { color: tierColors[item.tier] || colors.text.muted }]}>
                        {item.tier === 'vip' ? 'VIP' : item.tier.charAt(0).toUpperCase() + item.tier.slice(1)}
                    </Text>
                </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </TouchableOpacity>
    );

    return (
        <View style={s.container}>
            {!activeId ? (
                <NoRestaurantSelected />
            ) : (
                <>
                    {/* Page Header — matches Dashboard alignment */}
                    <View style={s.pageHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                            <Text style={s.brandLabel}>SavorIQ</Text>
                        </View>
                        <Text style={s.pageTitle}>Guests</Text>
                    </View>

                    {/* Filter Bar — matches Reviews layout */}
                    <View style={s.filterBar}>
                        {/* Search */}
                        <View style={s.searchBox}>
                            <Ionicons name="search" size={18} color={colors.text.muted} />
                            <TextInput
                                style={s.searchInput}
                                placeholder="Search guests..."
                                placeholderTextColor={colors.text.muted}
                                value={searchText}
                                onChangeText={setSearchText}
                                returnKeyType="search"
                            />
                            {searchText ? (
                                <TouchableOpacity onPress={() => setSearchText('')}>
                                    <Ionicons name="close-circle" size={18} color={colors.text.muted} />
                                </TouchableOpacity>
                            ) : null}
                        </View>

                        {/* Tier filters */}
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            {['all', 'vip', 'regular', 'new', 'slipping'].map((t) => (
                                <TouchableOpacity
                                    key={t}
                                    style={[s.filterChip, filterTier === (t === 'all' ? undefined : t) && s.filterChipActive]}
                                    onPress={() => setFilterTier(t === 'all' ? undefined : t)}
                                >
                                    <Text style={[s.filterChipText,
                                    filterTier === (t === 'all' ? undefined : t) && s.filterChipTextActive,
                                    ]}>
                                        {t === 'vip' ? 'VIP' : t.charAt(0).toUpperCase() + t.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        {/* Time selector — compact underlined tabs */}
                        <View style={{ flexDirection: 'row', gap: 16, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, paddingBottom: 6 }}>
                            {[
                                { label: '1M', value: 30 },
                                { label: '3M', value: 90 },
                                { label: '6M', value: 180 },
                                { label: '1Y', value: 365 },
                                { label: 'All', value: null },
                            ].map((range) => (
                                <TouchableOpacity
                                    key={range.label}
                                    onPress={() => setTimeRange(range.value)}
                                    style={{ paddingBottom: 4, borderBottomWidth: timeRange === range.value ? 2 : 0, borderBottomColor: colors.accent.gold, marginBottom: -7 }}
                                >
                                    <Text style={{
                                        fontSize: 13,
                                        fontWeight: timeRange === range.value ? '700' : '500',
                                        color: timeRange === range.value ? colors.accent.gold : colors.text.muted,
                                        letterSpacing: 0.3,
                                    }}>
                                        {range.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Stats + Sort */}
                    <View style={s.statsBar}>
                        <Text style={s.statText}>{displayGuests.length} guests</Text>
                        <Text style={s.statDivider}> · </Text>
                        <Text style={[s.statText, { color: colors.accent.gold }]}>{sortDescription}</Text>
                        <View style={{ flex: 1 }} />
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity
                                style={[s.sortButton, sortField === 'date' && s.sortButtonActive]}
                                onPress={() => {
                                    if (sortField === 'date') setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                                    else { setSortField('date'); setSortDir('desc'); }
                                }}
                            >
                                <Ionicons name="calendar-outline" size={12} color={sortField === 'date' ? colors.accent.gold : colors.text.muted} />
                                <Text style={[s.sortButtonText, sortField === 'date' && s.sortButtonTextActive]}>Date</Text>
                                {sortField === 'date' && (
                                    <Ionicons name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'} size={10} color={colors.accent.gold} />
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.sortButton, sortField === 'rating' && s.sortButtonActive]}
                                onPress={() => {
                                    if (sortField === 'rating') setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                                    else { setSortField('rating'); setSortDir('desc'); }
                                }}
                            >
                                <Ionicons name="star-outline" size={12} color={sortField === 'rating' ? colors.accent.gold : colors.text.muted} />
                                <Text style={[s.sortButtonText, sortField === 'rating' && s.sortButtonTextActive]}>Rating</Text>
                                {sortField === 'rating' && (
                                    <Ionicons name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'} size={10} color={colors.accent.gold} />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>

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
    pageHeader: {
        paddingHorizontal: spacing.md, paddingTop: 32, marginBottom: spacing.sm,
    },
    brandLabel: { color: colors.accent.gold, fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 1 },
    pageTitle: { color: colors.text.primary, fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
    list: { padding: spacing.md, paddingBottom: 40 },

    filterBar: { padding: spacing.md, gap: spacing.sm },
    searchBox: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.bg.input, borderRadius: radius.md,
        paddingHorizontal: spacing.md, height: 44,
        borderWidth: 1, borderColor: colors.border.default,
    },
    searchInput: { flex: 1, color: colors.text.primary, fontSize: fonts.sizes.md },
    filterRow: {
        flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap',
    },
    filterChip: {
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full,
        backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.subtle,
    },
    filterChipActive: { backgroundColor: colors.accent.gold + '20', borderColor: colors.accent.gold },
    filterChipText: { color: colors.text.muted, fontSize: fonts.sizes.sm, fontWeight: '500' },
    filterChipTextActive: { color: colors.accent.gold },

    statsBar: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    },
    statText: { color: colors.text.secondary, fontSize: fonts.sizes.sm },
    statDivider: { color: colors.text.muted, fontSize: fonts.sizes.sm },
    sortButton: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radius.full,
        backgroundColor: colors.bg.card,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    sortButtonActive: {
        backgroundColor: colors.accent.gold + '15',
        borderColor: colors.accent.gold + '40',
    },
    sortButtonText: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        fontWeight: '600' as const,
    },
    sortButtonTextActive: {
        color: colors.accent.gold,
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
