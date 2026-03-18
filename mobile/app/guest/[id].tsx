import React, { useMemo, useState, useEffect } from 'react';
import {
    View, Text, ScrollView, StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useData } from '@/lib/DataContext';
import { fetchGuestPulse, GuestPulse } from '@/lib/api';

export default function GuestDetailScreen() {
    const params = useLocalSearchParams<{
        id: string;
        name?: string;
        tier?: string;
        avg_rating?: string;
        visit_count?: string;
    }>();
    const { id } = params;
    const { guests: globalGuests, reviews: allReviews } = useData();
    const router = useRouter();

    // Hooks must be called before any early returns
    const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
    const [fallbackReviews, setFallbackReviews] = useState<any[]>([]);

    // Build instant guest from route params (passed from Guests tab)
    const routeGuest = params.name ? {
        id: id,
        name: params.name,
        tier: params.tier || 'new',
        avg_rating: params.avg_rating ? parseFloat(params.avg_rating) : null,
        visit_count: params.visit_count ? parseInt(params.visit_count) : 0,
        intercept_status: null as string | null,
    } : null;

    const guest = routeGuest || globalGuests.find(g => g.id === id);

    // Filter reviews from context data
    const contextReviews = useMemo(
        () => allReviews
            .filter(r => r.guest_id === id || r.guest_name === guest?.name)
            .sort((a, b) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime()),
        [allReviews, id, guest?.name]
    );

    // If context reviews are empty but guest has reviews, fetch from pulse API as fallback
    useEffect(() => {
        if (contextReviews.length === 0 && id) {
            fetchGuestPulse(id)
                .then(data => {
                    if (data?.recent_reviews?.length) {
                        setFallbackReviews(data.recent_reviews);
                    }
                })
                .catch(() => {});
        }
    }, [contextReviews.length, id]);

    // Use context reviews if available, otherwise fallback
    const guestReviews = contextReviews.length > 0 ? contextReviews : fallbackReviews;

    if (!guest) {
        return (
            <View style={s.center}>
                <Stack.Screen options={{ headerShown: false }} />
                <Text style={s.errorText}>Guest not found</Text>
            </View>
        );
    }

    const reviewCount = guestReviews.length || guest.visit_count || 0;
    const avgRating = guest.avg_rating;
    const tierColor: Record<string, string> = {
        vip: colors.accent.gold,
        regular: colors.accent.green,
        new: colors.accent.gold,
        slipping: colors.accent.red,
    };
    const guestColor = tierColor[guest.tier] || colors.text.muted;

    const ratingColor = (rating: number) => {
        if (rating <= 2) return colors.accent.red;
        if (rating <= 3.5) return colors.accent.gold;
        return colors.accent.green;
    };

    // Platform breakdown
    const googleCount = guestReviews.filter(r => r.platform === 'google').length;
    const yelpCount = guestReviews.filter(r => r.platform === 'yelp').length;

    // First review date
    const firstReview = guestReviews.length > 0 ? guestReviews[guestReviews.length - 1] : null;

    const renderStars = (rating: number) => {
        const r = Math.round(rating || 0);
        return '★'.repeat(Math.max(0, Math.min(5, r))) + '☆'.repeat(Math.max(0, Math.min(5, 5 - r)));
    };

    return (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Back Button */}
            <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={22} color={colors.text.primary} />
                <Text style={s.backText}>Guests</Text>
            </TouchableOpacity>

            {/* Profile Header */}
            <View style={s.profileHeader}>
                <View style={[s.avatarLarge, { backgroundColor: guestColor + '20' }]}>
                    <Text style={[s.avatarLargeText, { color: guestColor }]}>
                        {guest.name.charAt(0).toUpperCase()}
                    </Text>
                </View>
                <Text style={s.guestName}>{guest.name}</Text>

                <View style={s.headerMeta}>
                    {guest.tier !== 'new' && (
                        <View style={[s.tierBadge, { backgroundColor: guestColor + '20' }]}>
                            <Text style={[s.tierText, { color: guestColor }]}>
                                {guest.tier === 'vip' ? 'VIP' : guest.tier.charAt(0).toUpperCase() + guest.tier.slice(1)}
                            </Text>
                        </View>
                    )}
                    <Text style={s.headerStat}>
                        {reviewCount} review{reviewCount !== 1 ? 's' : ''}
                    </Text>
                    {avgRating ? (
                        <Text style={[s.headerStat, { color: ratingColor(avgRating) }]}>
                            ★ {avgRating.toFixed(1)}
                        </Text>
                    ) : null}
                </View>
            </View>

            {/* Stats Grid */}
            <View style={s.statsGrid}>
                <StatBox label="Reviews" value={String(reviewCount)} icon="chatbubbles-outline" />
                <StatBox label="Avg Rating" value={avgRating ? avgRating.toFixed(1) : 'N/A'} icon="star" />
                {guestReviews.length > 0 && (
                    <>
                        <View style={s.statBox}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {googleCount > 0 && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                        <Ionicons name="logo-google" size={14} color="#4285F4" />
                                        <Text style={[s.statValue, { fontSize: fonts.sizes.lg }]}>{googleCount}</Text>
                                    </View>
                                )}
                                {yelpCount > 0 && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                        <Ionicons name="star-outline" size={14} color="#FF1A1A" />
                                        <Text style={[s.statValue, { fontSize: fonts.sizes.lg }]}>{yelpCount}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={s.statLabel}>Platforms</Text>
                        </View>
                        <View style={s.statBox}>
                            <Text style={[s.statValue, { fontSize: fonts.sizes.sm }]}>
                                {new Date(firstReview!.reviewed_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })}
                            </Text>
                            <Text style={s.statLabel}>First Review</Text>
                        </View>
                    </>
                )}
            </View>

            {/* Reviews */}
            <View style={s.reviewsSection}>
                <Text style={s.sectionHeader}>Reviews</Text>
                {guestReviews.length === 0 ? (
                    <Text style={s.emptyText}>
                        {guest.visit_count ? 'Loading reviews...' : 'No reviews yet.'}
                    </Text>
                ) : (
                    guestReviews.map((r) => {
                        const isExpanded = expandedReviews.has(r.id);
                        return (
                        <TouchableOpacity
                            key={r.id}
                            style={s.reviewItem}
                            activeOpacity={0.7}
                            onPress={() => {
                                setExpandedReviews(prev => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id);
                                    else next.add(r.id);
                                    return next;
                                });
                            }}
                        >
                            <View style={s.reviewMeta}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <Text style={s.reviewStars}>{renderStars(r.rating)}</Text>
                                    <View style={[s.platformBadge, {
                                        backgroundColor: r.platform === 'google' ? '#4285F420' : '#FF1A1A20',
                                    }]}>
                                        <Ionicons
                                            name={r.platform === 'google' ? 'logo-google' : 'star-outline'}
                                            size={10}
                                            color={r.platform === 'google' ? '#4285F4' : '#FF1A1A'}
                                        />
                                        <Text style={[s.platformText, {
                                            color: r.platform === 'google' ? '#4285F4' : '#FF1A1A',
                                        }]}>
                                            {r.platform === 'google' ? 'Google' : 'Yelp'}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={s.reviewDate}>
                                    {new Date(r.reviewed_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                                </Text>
                            </View>
                            <Text style={s.reviewContent} numberOfLines={isExpanded ? undefined : 3}>{r.content}</Text>
                        </TouchableOpacity>
                        );
                    })
                )}
            </View>
        </ScrollView>
    );
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: string }) {
    return (
        <View style={s.statBox}>
            <Ionicons name={icon as any} size={16} color={colors.text.muted} />
            <Text style={s.statValue}>{value}</Text>
            <Text style={s.statLabel}>{label}</Text>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    content: { padding: spacing.md, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg.primary, paddingTop: 60 },
    errorText: { color: colors.text.muted, fontSize: fonts.sizes.md },

    backBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingTop: 20, paddingBottom: spacing.sm,
    },
    backText: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },

    profileHeader: { alignItems: 'center', paddingVertical: spacing.md },
    avatarLarge: {
        width: 80, height: 80, borderRadius: 40,
        justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
    },
    avatarLargeText: { fontSize: fonts.sizes.hero, fontWeight: '700' },
    guestName: { color: colors.text.primary, fontSize: fonts.sizes.xxl, fontWeight: '700' },
    headerMeta: {
        flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.sm,
    },
    tierBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.full },
    tierText: { fontSize: fonts.sizes.sm, fontWeight: '700', letterSpacing: 1 },
    headerStat: { color: colors.text.muted, fontSize: fonts.sizes.sm, fontWeight: '500' },

    statsGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md,
    },
    statBox: {
        width: '48%', backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    statValue: { color: colors.text.primary, fontSize: fonts.sizes.xl, fontWeight: '700' },
    statLabel: { color: colors.text.muted, fontSize: fonts.sizes.xs, textTransform: 'uppercase' },

    reviewsSection: { marginTop: spacing.sm },
    sectionHeader: { color: colors.text.primary, fontSize: fonts.sizes.lg, fontWeight: '700', marginBottom: spacing.sm },
    reviewItem: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    reviewMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    reviewStars: { fontSize: 14, color: colors.accent.gold },
    reviewDate: { color: colors.text.muted, fontSize: 12 },
    reviewContent: { color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md, textAlign: 'center', marginTop: 20 },

    platformBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 3,
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
    },
    platformText: { fontSize: 9, fontWeight: '600' },
});
