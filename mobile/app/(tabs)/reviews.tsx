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
    const { search: incomingSearch } = useLocalSearchParams<{ search?: string }>();
    const { activeId, loading: contextLoading } = useRestaurant();
    const { reviews: globalReviews, reviewStats: globalStats, refreshAll } = useData();

    const [reviews, setReviews] = useState<Review[]>([]);
    const [stats, setStats] = useState<ReviewStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState(incomingSearch || '');
    const [platform, setPlatform] = useState<string | undefined>();

    // Sync search state with incoming route parameters
    useEffect(() => {
        if (incomingSearch !== undefined) {
            setSearch(incomingSearch || '');
        }
    }, [incomingSearch]);

    const loadData = useCallback(async () => {
        if (!activeId) {
            setLoading(false);
            setRefreshing(false);
            return;
        }

        // If no filters, use global data instantly
        if (!search && !platform) {
            setReviews(globalReviews);
            setStats(globalStats);
            setLoading(false);
            setRefreshing(false);
            return;
        }

        try {
            const finalSearch = incomingSearch !== undefined ? incomingSearch : search;
            const filters = { search: finalSearch || undefined, platform };
            const [r, s] = await Promise.all([
                fetchAllReviews(filters),
                fetchReviewStats(filters),
            ]);
            setReviews(r);
            setStats(s);
        } catch (e) {
            console.error('Reviews load error:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [activeId, search, platform, globalReviews, globalStats, incomingSearch]);

    useFocusEffect(
        useCallback(() => {
            if (!activeId && !contextLoading) {
                setLoading(false);
                return;
            }
            loadData();
        }, [activeId, contextLoading, loadData])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        if (!search && !platform) {
            await refreshAll();
        } else {
            await loadData();
        }
        setRefreshing(false);
    };

    const renderStars = (rating: number) => {
        const r = Math.round(rating || 0);
        return '★'.repeat(Math.max(0, Math.min(5, r))) + '☆'.repeat(Math.max(0, Math.min(5, 5 - r)));
    };

    const platformColor = (p: string) =>
        p === 'yelp' ? colors.platform.yelp : colors.platform.google;

    const renderReview = ({ item }: { item: Review }) => (
        <View style={s.reviewCard}>
            <View style={s.reviewHeader}>
                <View style={[s.platformDot, { backgroundColor: platformColor(item.platform) }]} />
                <Text style={s.authorName}>{item.author_name || 'Guest'}</Text>
                <Text style={s.reviewDate}>
                    {new Date(item.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
            </View>
            <Text style={[s.stars, {
                color: item.rating >= 4 ? colors.accent.gold :
                    item.rating >= 3 ? colors.text.secondary : colors.accent.red,
            }]}>
                {renderStars(item.rating)}
            </Text>
            <Text style={s.reviewContent} numberOfLines={4}>
                {item.content}
            </Text>
        </View>
    );

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
                                onSubmitEditing={loadData}
                                returnKeyType="search"
                            />
                            {search ? (
                                <TouchableOpacity onPress={() => { setSearch(''); }}>
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
                        </View>
                    </View>

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
                    {loading ? (
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
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md },
});
