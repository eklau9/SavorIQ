import React, { useState, useCallback, useEffect } from 'react';
import {
    View, Text, FlatList, StyleSheet, RefreshControl,
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
    const { search: incomingSearch, sentiment: incomingSentiment, days: incomingDays } = useLocalSearchParams<{ search?: string; sentiment?: string; days?: string }>();
    const { activeId, loading: contextLoading } = useRestaurant();
    const { reviews: globalReviews, reviewStats: globalStats, refreshAll, timeRange, setTimeRange } = useData();

    const [reviews, setReviews] = useState<Review[]>([]);
    const [stats, setStats] = useState<ReviewStats | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState(incomingSearch || '');
    const [sentiment, setSentiment] = useState<string | undefined>(incomingSentiment);
    const [platform, setPlatform] = useState<string | undefined>();

    // Sync search state with incoming route parameters
    useEffect(() => {
        if (incomingSearch !== undefined) {
            setSearch(incomingSearch || '');
        }
        if (incomingSentiment !== undefined) {
            setSentiment(incomingSentiment);
        }
    }, [incomingSearch, incomingSentiment]);

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
            const matchesPlatform = !platform || r.platform === platform;
            const matchesSentiment = !sentiment || (
                sentiment === 'positive' ? r.rating >= 4 :
                    sentiment === 'negative' ? r.rating <= 2 :
                        true
            );
            const matchesSearch = !finalSearch || (
                (r.author_name?.toLowerCase().includes(finalSearch)) ||
                (r.content?.toLowerCase().includes(finalSearch))
            );
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
    }, [activeId, globalReviews, search, platform, sentiment, timeRange, globalStats]);

    const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});

    const onRefresh = async () => {
        setRefreshing(true);
        await refreshAll();
        setRefreshing(false);
    };

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
                        {new Date(item.reviewed_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
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
                        <View style={s.platformRow}>
                            {['all', 'google', 'yelp'].map((p) => (
                                <TouchableOpacity
                                    key={p}
                                    style={[s.platformChip, platform === (p === 'all' ? undefined : p) && s.platformChipActive]}
                                    onPress={() => setPlatform(p === 'all' ? undefined : p)}
                                >
                                    <Text style={[s.platformChipText,
                                    platform === (p === 'all' ? undefined : p) && s.platformChipTextActive,
                                    ]}>
                                        {p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                            <View style={{ flex: 1 }} />
                            {[
                                { label: '30D', value: 30 },
                                { label: '90D', value: 90 },
                                { label: '6MO', value: 180 },
                                { label: '1Y', value: 365 },
                                { label: 'ALL', value: undefined },
                            ].map((range) => (
                                <TouchableOpacity
                                    key={range.label}
                                    style={[s.platformChip, timeRange === range.value && s.platformChipActive]}
                                    onPress={() => setTimeRange(range.value)}
                                >
                                    <Text style={[s.platformChipText,
                                        timeRange === range.value && s.platformChipTextActive,
                                    ]}>
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

                    {/* Stats Bar */}
                    {stats && (
                        <View style={s.statsBar}>
                            <Text style={s.statText}>{stats.total} reviews</Text>
                            <Text style={s.statDivider}>·</Text>
                            <Text style={[s.statText, { color: colors.accent.gold }]}>
                                {stats.avg_rating?.toFixed(1)} ★
                            </Text>
                        </View>
                    )}

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
                            refreshControl={
                                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.gold} />
                            }
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

    platformRow: { flexDirection: 'row', gap: spacing.sm },
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
    reviewDate: { color: colors.text.muted, fontSize: fonts.sizes.xs },
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
});
