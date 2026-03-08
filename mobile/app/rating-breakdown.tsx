import React from 'react';
import {
    View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useData } from '@/lib/DataContext';

export default function RatingBreakdownScreen() {
    const router = useRouter();
    const { reviewStats: stats } = useData();

    if (!stats) {
        return (
            <View style={s.center}>
                <Text style={s.emptyText}>No rating data available.</Text>
            </View>
        );
    }

    const { rating_distribution: dist, avg_rating, total } = stats;
    const maxCount = Math.max(...Object.values(dist), 1);

    const renderBar = (stars: number) => {
        const count = dist[stars] || 0;
        const width = (count / maxCount) * 100;

        return (
            <TouchableOpacity
                key={stars}
                style={s.barRow}
                onPress={() => router.push(`/reviews?search=${stars}★`)}
            >
                <Text style={s.starLabel}>{stars} ★</Text>
                <View style={s.barContainer}>
                    <View style={[s.barFill, { width: `${width}%` }]} />
                </View>
                <Text style={s.countLabel}>{count}</Text>
            </TouchableOpacity>
        );
    };

    return (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
            <Stack.Screen options={{ title: 'Rating Breakdown', headerBackTitle: 'Dashboard' }} />

            {/* Overview Card */}
            <View style={s.overviewCard}>
                <Text style={s.bigRating}>{avg_rating.toFixed(1)}</Text>
                <View style={s.starsRow}>
                    {[1, 2, 3, 4, 5].map(i => (
                        <Ionicons
                            key={i}
                            name={i <= Math.round(avg_rating) ? "star" : "star-outline"}
                            size={24}
                            color={colors.accent.gold}
                        />
                    ))}
                </View>
                <Text style={s.totalLabel}>Based on {total} reviews</Text>
            </View>

            {/* Distribution */}
            <View style={s.card}>
                <Text style={s.cardTitle}>Star Distribution</Text>
                <View style={s.distributionContainer}>
                    {[5, 4, 3, 2, 1].map(stars => renderBar(stars))}
                </View>
            </View>

            {/* Sentiment Highlights */}
            <View style={s.highlightsRow}>
                <TouchableOpacity
                    style={[s.highlightCard, { borderColor: colors.sentiment.positive + '40' }]}
                    onPress={() => router.push('/reviews?sentiment=positive')}
                >
                    <Ionicons name="happy-outline" size={32} color={colors.sentiment.positive} />
                    <Text style={s.highlightValue}>{stats.positive}</Text>
                    <Text style={s.highlightLabel}>Positive</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[s.highlightCard, { borderColor: colors.accent.red + '40' }]}
                    onPress={() => router.push('/reviews?sentiment=negative')}
                >
                    <Ionicons name="sad-outline" size={32} color={colors.accent.red} />
                    <Text style={s.highlightValue}>{stats.negative}</Text>
                    <Text style={s.highlightLabel}>Negative</Text>
                </TouchableOpacity>
            </View>

            {/* Top Categories */}
            <View style={s.card}>
                <Text style={s.cardTitle}>Sentiment by Category</Text>
                {Object.entries(stats.bucket_averages).map(([bucket, score]) => (
                    <View key={bucket} style={s.bucketRow}>
                        <Text style={s.bucketLabel}>{bucket.charAt(0).toUpperCase() + bucket.slice(1)}</Text>
                        <View style={s.bucketRight}>
                            <Text style={[s.bucketScore, { color: score >= 0.3 ? colors.accent.green : score <= -0.3 ? colors.accent.red : colors.text.secondary }]}>
                                {score > 0 ? '+' : ''}{score.toFixed(2)}
                            </Text>
                            <Ionicons
                                name={score >= 0 ? "trending-up" : "trending-down"}
                                size={14}
                                color={score >= 0 ? colors.accent.green : colors.accent.red}
                            />
                        </View>
                    </View>
                ))}
            </View>

            <TouchableOpacity
                style={s.viewReviewsBtn}
                onPress={() => router.push('/reviews')}
            >
                <Text style={s.viewReviewsText}>View All Reviews</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
        </ScrollView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    content: { padding: spacing.md, paddingBottom: 40 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md },

    overviewCard: {
        backgroundColor: colors.bg.card, borderRadius: radius.lg,
        padding: spacing.xl, alignItems: 'center', marginBottom: spacing.md,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    bigRating: { fontSize: 64, fontWeight: '800', color: colors.text.primary, marginBottom: spacing.xs },
    starsRow: { flexDirection: 'row', gap: 4, marginBottom: spacing.sm },
    totalLabel: { color: colors.text.muted, fontSize: fonts.sizes.sm },

    card: {
        backgroundColor: colors.bg.card, borderRadius: radius.lg,
        padding: spacing.md, marginBottom: spacing.md,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    cardTitle: { color: colors.text.primary, fontSize: fonts.sizes.lg, fontWeight: '700', marginBottom: spacing.md },

    distributionContainer: { gap: spacing.sm },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    starLabel: { color: colors.text.secondary, fontSize: fonts.sizes.sm, width: 35, fontWeight: '600' },
    barContainer: { flex: 1, height: 12, backgroundColor: colors.bg.secondary, borderRadius: 6, overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: colors.accent.gold },
    countLabel: { color: colors.text.muted, fontSize: fonts.sizes.sm, width: 40, textAlign: 'right' },

    highlightsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    highlightCard: {
        flex: 1, backgroundColor: colors.bg.card, borderRadius: radius.lg,
        padding: spacing.md, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    highlightValue: { color: colors.text.primary, fontSize: fonts.sizes.xxl, fontWeight: '700' },
    highlightLabel: { color: colors.text.muted, fontSize: fonts.sizes.xs, textTransform: 'uppercase' },

    bucketRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
    },
    bucketLabel: { color: colors.text.secondary, fontSize: fonts.sizes.md },
    bucketRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    bucketScore: { fontSize: fonts.sizes.md, fontWeight: '700' },

    viewReviewsBtn: {
        backgroundColor: colors.accent.blue, flexDirection: 'row',
        padding: spacing.md, borderRadius: radius.md,
        justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
        marginTop: spacing.sm,
    },
    viewReviewsText: { color: '#fff', fontSize: fonts.sizes.md, fontWeight: '700' },
});
