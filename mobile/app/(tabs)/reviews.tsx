import React, { useState, useCallback, useEffect } from 'react';
import {
    View, Text, FlatList, StyleSheet,
    ActivityIndicator, TextInput, TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import { fetchAllReviews, fetchReviewStats, Review, ReviewStats } from '@/lib/api';
import NoRestaurantSelected from '@/components/NoRestaurantSelected';

export default function ReviewsScreen() {
    const { search: incomingSearch, sentiment: incomingSentiment, days: incomingDays, ids: incomingIds } = useLocalSearchParams<{ search?: string; sentiment?: string; days?: string; ids?: string }>();
    const { activeId, loading: contextLoading } = useRestaurant();
    const { reviews: globalReviews, reviewStats: globalStats, refreshAll, timeRange, setTimeRange } = useData();

    const [reviews, setReviews] = useState<Review[]>([]);
    const [stats, setStats] = useState<ReviewStats | null>(null);

    const [search, setSearch] = useState(incomingSearch || '');
    const [sentiment, setSentiment] = useState<string | undefined>(incomingSentiment);
    const [platform, setPlatform] = useState<string | undefined>();
    const [dateSort, setDateSort] = useState<'desc' | 'asc'>('desc');
    const [ratingSort, setRatingSort] = useState<'desc' | 'asc' | null>('asc');
    const [filterIds, setFilterIds] = useState<string[] | null>(
        incomingIds ? incomingIds.split(',').map(id => decodeURIComponent(id)) : null
    );

    // Sync search state with incoming route parameters
    useEffect(() => {
        if (incomingSearch !== undefined) {
            setSearch(incomingSearch || '');
            setFilterIds(null); // Clear ID filter when switching to keyword search
        }
        if (incomingSentiment !== undefined) {
            setSentiment(incomingSentiment);
        }
        if (incomingIds !== undefined) {
            setFilterIds(incomingIds ? incomingIds.split(',').map(id => decodeURIComponent(id)) : null);
            setSearch(''); // Clear text search when using ID filter
        }
    }, [incomingSearch, incomingSentiment, incomingIds]);

    // Sync days filter with incoming route parameter (from insight tap)
    useEffect(() => {
        if (incomingDays !== undefined) {
            setTimeRange(Number(incomingDays) || null);
        }
    }, [incomingDays]);

    // 1. Local Filtering Logic (Instant Feedback)
    useEffect(() => {
        if (!activeId || globalReviews.length === 0) return;

        const finalSearch = search.trim().toLowerCase();

        const filtered = globalReviews.filter(r => {
            // If filtering by specific review IDs (from insight tap), use that exclusively
            if (filterIds && filterIds.length > 0) {
                return filterIds.includes(r.id);
            }
            
            const matchesPlatform = !platform || r.platform === platform;
            const matchesSentiment = !sentiment || (
                sentiment === 'positive' ? r.rating >= 4 :
                    sentiment === 'negative' ? r.rating <= 2 :
                        true
            );
            const matchesSearch = !finalSearch || (() => {
                const text = ((r.author_name || '') + ' ' + (r.content || '')).toLowerCase();
                if (finalSearch.includes('|')) {
                    // OR search: match if any keyword is found
                    return finalSearch.split('|').some(term => term.trim() && text.includes(term.trim()));
                }
                return text.includes(finalSearch);
            })();
            // Date filter: only show reviews within the timeRange
            let matchesDate = true;
            if (timeRange && r.reviewed_at) {
                const reviewDate = new Date(r.reviewed_at);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - timeRange);
                matchesDate = reviewDate >= cutoff;
            }
            return matchesPlatform && matchesSentiment && matchesSearch && matchesDate;
        });

        // Apply sort: rating is primary when active, date is always secondary
        filtered.sort((a, b) => {
            if (ratingSort) {
                const rDiff = ratingSort === 'desc' ? b.rating - a.rating : a.rating - b.rating;
                if (rDiff !== 0) return rDiff;
            }
            const dDiff = dateSort === 'desc'
                ? new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime()
                : new Date(a.reviewed_at).getTime() - new Date(b.reviewed_at).getTime();
            return dDiff;
        });

        setReviews(filtered);

        // Calculate basic stats locally for instant update
        if (filtered.length > 0) {
            const sum = filtered.reduce((acc, r) => acc + r.rating, 0);
            setStats(prev => ({
                ...(prev || {
                    total: 0, avg_rating: 0, positive: 0, negative: 0, neutral: 0,
                    top_strength: null, top_friction: null, bucket_averages: {}, rating_distribution: {}
                }),
                total: filtered.length,
                avg_rating: sum / filtered.length
            }));
        } else if (!finalSearch && !platform && !sentiment) {
            setStats(globalStats);
        }
    }, [activeId, globalReviews, search, platform, sentiment, timeRange, globalStats, dateSort, ratingSort, filterIds]);

    const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});



    const toggleExpand = (id: string) => {
        setExpandedReviews(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const highlightSearch = (text: string, query: string) => {
        if (!query.trim()) return <Text>{text}</Text>;

        const parts = text.split(new RegExp(`(${query})`, 'gi'));
        return (
            <Text>
                {parts.map((part, i) =>
                    part.toLowerCase() === query.toLowerCase() ? (
                        <Text key={i} style={s.highlight}>{part}</Text>
                    ) : (
                        <Text key={i}>{part}</Text>
                    )
                )}
            </Text>
        );
    };

    const renderStars = (rating: number) => {
        const r = Math.round(rating || 0);
        return '★'.repeat(Math.max(0, Math.min(5, r))) + '☆'.repeat(Math.max(0, Math.min(5, 5 - r)));
    };

    const platformColor = (p: string) =>
        p === 'yelp' ? colors.platform.yelp : colors.platform.google;

    const renderReview = ({ item }: { item: Review }) => {
        const isExpanded = expandedReviews[item.id];
        return (
            <TouchableOpacity
                style={s.reviewCard}
                activeOpacity={0.8}
                onPress={() => toggleExpand(item.id)}
            >
                <View style={s.reviewHeader}>
                    <View style={[s.platformDot, { backgroundColor: platformColor(item.platform) }]} />
                    <Text style={s.authorName}>{item.guest_name || item.author_name || 'Guest'}</Text>
                    <Text style={s.reviewDate}>
                        {new Date(item.reviewed_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                </View>
                <Text style={[s.stars, {
                    color: item.rating >= 4 ? colors.accent.gold :
                        item.rating >= 3 ? colors.text.secondary : colors.accent.red,
                }]}>
                    {renderStars(item.rating)}
                </Text>
                <Text style={s.reviewContent} numberOfLines={isExpanded ? undefined : 4}>
                    {highlightSearch(item.content, search)}
                </Text>
                {!isExpanded && item.content.length > 200 && (
                    <Text style={s.readMore}>Tap to read more...</Text>
                )}
            </TouchableOpacity>
        );
    };

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
                        <Text style={s.pageTitle}>Reviews</Text>
                    </View>

                    {/* Search + Filters */}
                    <View style={s.filterBar}>
                        <View style={s.searchBox}>
                            <Ionicons name="search" size={16} color={colors.text.muted} />
                            <TextInput
                                style={s.searchInput}
                                placeholder="Search reviews..."
                                placeholderTextColor={colors.text.muted}
                                value={search}
                                onChangeText={setSearch}
                                returnKeyType="search"
                            />
                            {search ? (
                                <TouchableOpacity onPress={() => setSearch('')}>
                                    <Ionicons name="close-circle" size={18} color={colors.text.muted} />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                        {/* Platform filters — row 1 */}
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            {[
                                { label: 'Google', value: 'google' },
                                { label: 'Yelp', value: 'yelp' },
                                { label: 'All', value: undefined },
                            ].map((p) => (
                                <TouchableOpacity
                                    key={p.label}
                                    style={[s.platformChip, platform === p.value && s.platformChipActive]}
                                    onPress={() => setPlatform(p.value)}
                                >
                                    <Text style={[s.platformChipText,
                                    platform === p.value && s.platformChipTextActive,
                                    ]}>{p.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {/* Time selector — row 2, right-aligned */}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, paddingTop: 4 }}>
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
                                    style={{ paddingBottom: 2 }}
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

                    {/* Active Filter Indicator */}
                    {sentiment && (
                        <View style={s.activeFilterBar}>
                            <Text style={s.activeFilterText}>
                                Showing <Text style={s.bold}>{sentiment}</Text> reviews
                            </Text>
                            <TouchableOpacity onPress={() => setSentiment(undefined)}>
                                <Ionicons name="close-circle" size={16} color={colors.accent.gold} />
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Insight Review ID Filter Indicator */}
                    {filterIds && filterIds.length > 0 && (
                        <View style={s.activeFilterBar}>
                            <Ionicons name="sparkles" size={14} color={colors.accent.gold} />
                            <Text style={s.activeFilterText}>
                                Showing <Text style={s.bold}>{reviews.length}</Text> reviews related to this insight
                            </Text>
                            <TouchableOpacity onPress={() => setFilterIds(null)}>
                                <Text style={{ color: colors.accent.gold, fontSize: fonts.sizes.xs, fontWeight: '700' }}>Show All</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Stats Bar + Sort */}
                    <View style={s.statsBar}>
                        {stats && (
                            <>
                                <Text style={s.statText}>{stats.total} reviews</Text>
                                <Text style={s.statDivider}>·</Text>
                                <Text style={[s.statText, { color: colors.accent.gold }]}>
                                    {stats.avg_rating?.toFixed(1)} ★
                                </Text>
                                <Text style={s.statDivider}> · </Text>
                                <Text style={[s.statText, { color: colors.accent.gold }]}>
                                    {ratingSort
                                        ? `${ratingSort === 'desc' ? 'Highest rated' : 'Lowest rated'}${dateSort === 'desc' ? ', newest' : ', oldest'}`
                                        : (dateSort === 'desc' ? 'Newest first' : 'Oldest first')
                                    }
                                </Text>
                            </>
                        )}
                        <View style={{ flex: 1 }} />
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity
                                style={[s.sortButton, s.sortButtonActive]}
                                onPress={() => setDateSort(dateSort === 'desc' ? 'asc' : 'desc')}
                            >
                                <Ionicons name="calendar-outline" size={12} color={colors.accent.gold} />
                                <Text style={[s.sortButtonText, s.sortButtonTextActive]}>Date</Text>
                                <Ionicons name={dateSort === 'desc' ? 'arrow-down' : 'arrow-up'} size={10} color={colors.accent.gold} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.sortButton, ratingSort && s.sortButtonActive]}
                                onPress={() => {
                                    if (!ratingSort) setRatingSort('desc');
                                    else if (ratingSort === 'desc') setRatingSort('asc');
                                    else setRatingSort(null);
                                }}
                            >
                                <Ionicons name="star-outline" size={12} color={ratingSort ? colors.accent.gold : colors.text.muted} />
                                <Text style={[s.sortButtonText, ratingSort && s.sortButtonTextActive]}>Rating</Text>
                                {ratingSort && (
                                    <Ionicons name={ratingSort === 'desc' ? 'arrow-down' : 'arrow-up'} size={10} color={colors.accent.gold} />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Reviews List */}
                    {contextLoading && reviews.length === 0 ? (
                        <View style={s.center}>
                            <ActivityIndicator size="large" color={colors.accent.gold} />
                        </View>
                    ) : (
                        <FlatList
                            data={reviews}
                            renderItem={renderReview}
                            keyExtractor={(item) => String(item.id)}
                            contentContainerStyle={s.list}
                            ListEmptyComponent={
                                <View style={s.center}>
                                    <Text style={s.emptyText}>No reviews found</Text>
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

    platformRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    platformChip: {
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full,
        backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.subtle,
    },
    platformChipActive: {
        backgroundColor: colors.accent.gold + '20', borderColor: colors.accent.gold,
    },
    platformChipText: { color: colors.text.muted, fontSize: fonts.sizes.sm, fontWeight: '500' },
    platformChipTextActive: { color: colors.accent.gold },

    statsBar: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    },
    statText: { color: colors.text.secondary, fontSize: fonts.sizes.sm },
    statDivider: { color: colors.text.muted, fontSize: fonts.sizes.sm },

    reviewCard: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    reviewHeader: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginBottom: 6,
    },
    platformDot: { width: 8, height: 8, borderRadius: 4 },
    authorName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600', flex: 1 },
    reviewDate: { color: colors.text.primary, fontSize: fonts.sizes.sm },
    stars: { fontSize: fonts.sizes.md, marginBottom: 6 },
    reviewContent: { color: colors.text.secondary, fontSize: fonts.sizes.sm, lineHeight: 20 },
    highlight: { backgroundColor: colors.accent.gold + '40', color: colors.text.primary, fontWeight: '700' },
    readMore: { color: colors.accent.gold, fontSize: fonts.sizes.xs, marginTop: 8, fontWeight: '600' },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md },

    activeFilterBar: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    },
    activeFilterText: { color: colors.text.secondary, fontSize: fonts.sizes.xs },
    bold: { fontWeight: '700', textTransform: 'uppercase', color: colors.accent.gold },
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
});
