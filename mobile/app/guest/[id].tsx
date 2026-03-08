import React, { useState, useEffect } from 'react';
import {
    View, Text, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { fetchGuestPulse, GuestPulse, Review } from '@/lib/api';

import { useData } from '@/lib/DataContext';

export default function GuestDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { guests: globalGuests } = useData();

    // Find basic guest info from cache for instant display
    const cachedGuest = globalGuests.find(g => g.id === id);

    const [pulse, setPulse] = useState<GuestPulse | null>(null);
    const [loading, setLoading] = useState(!cachedGuest); // Only show full loading if not in cache

    useEffect(() => {
        if (!id) return;
        (async () => {
            try {
                const data = await fetchGuestPulse(id);
                setPulse(data);
            } catch (e) {
                console.error('Guest detail error:', e);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    // Use cached guest for basic info while pulse loads
    const guest = pulse?.guest || cachedGuest;

    if (loading && !guest) {
        return (
            <View style={s.center}>
                <ActivityIndicator size="large" color={colors.accent.gold} />
            </View>
        );
    }

    if (!guest) {
        return (
            <View style={s.center}>
                <Text style={s.errorText}>Guest not found</Text>
            </View>
        );
    }

    // Show loading state for pulse data if needed
    const pulseLoading = !pulse && loading;

    const tierColor: Record<string, string> = {
        vip: colors.accent.gold,
        regular: colors.accent.blue,
        new: colors.accent.green,
        slipping: colors.accent.red,
    };

    const renderStars = (rating: number) => {
        const r = Math.round(rating || 0);
        return '★'.repeat(Math.max(0, Math.min(5, r))) + '☆'.repeat(Math.max(0, Math.min(5, 5 - r)));
    };

    return (
        <ScrollView style={s.container} contentContainerStyle={s.content}>
            {/* Profile Header */}
            <View style={s.profileHeader}>
                <View style={[s.avatarLarge, { backgroundColor: (tierColor[guest.tier] || colors.text.muted) + '20' }]}>
                    <Text style={[s.avatarLargeText, { color: tierColor[guest.tier] || colors.text.muted }]}>
                        {guest.name.charAt(0).toUpperCase()}
                    </Text>
                </View>
                <Text style={s.guestName}>{guest.name}</Text>
                <View style={[s.tierBadge, { backgroundColor: (tierColor[guest.tier] || colors.text.muted) + '20' }]}>
                    <Text style={[s.tierText, { color: tierColor[guest.tier] || colors.text.muted }]}>
                        {guest.tier.toUpperCase()}
                    </Text>
                </View>
            </View>

            {/* Stats Grid */}
            <View style={s.statsGrid}>
                <StatBox
                    label="Reviews"
                    value={pulse ? String(pulse.visit_count) : String(guest.visit_count || '...')}
                    icon="chatbubbles-outline"
                />
                <StatBox
                    label="Avg Rating"
                    value={guest.avg_rating ? guest.avg_rating.toFixed(1) : 'N/A'}
                    icon="star"
                />
                <StatBox
                    label="Engagement"
                    value={pulse ? (pulse.review_engagement_score * 100).toFixed(0) + '%' : '...%'}
                    icon="flash"
                />
                <StatBox
                    label="Status"
                    value={guest.intercept_status || 'None'}
                    icon="flag"
                />
            </View>

            {/* Sentiment Pulse */}
            <View style={s.card}>
                <Text style={s.cardTitle}>Sentiment Pulse</Text>
                {pulseLoading ? (
                    <ActivityIndicator size="small" color={colors.accent.gold} style={{ marginVertical: 10 }} />
                ) : pulse ? (
                    <View style={s.sentimentRow}>
                        {pulse.sentiment_summary.map((s_item) => (
                            <View key={s_item.bucket} style={s.sentimentItem}>
                                <Text style={s.sentimentLabel}>{s_item.bucket === 'ambiance' ? 'Vibe' : s_item.bucket.charAt(0).toUpperCase() + s_item.bucket.slice(1)}</Text>
                                <Text style={[s.sentimentScore, { color: s_item.avg_score >= 0.5 ? colors.accent.green : s_item.avg_score <= -0.5 ? colors.accent.red : colors.text.secondary }]}>
                                    {s_item.avg_score > 0 ? '+' : ''}{s_item.avg_score.toFixed(1)}
                                </Text>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={s.emptyText}>No sentiment data available</Text>
                )}
            </View>

            {/* Recent Reviews */}
            <View style={s.reviewsSection}>
                <Text style={s.sectionHeader}>Recent Reviews</Text>
                {pulseLoading ? (
                    <ActivityIndicator size="small" color={colors.accent.gold} style={{ marginTop: 20 }} />
                ) : (pulse?.recent_reviews?.length || 0) === 0 ? (
                    <Text style={s.emptyText}>No reviews left yet.</Text>
                ) : (
                    pulse?.recent_reviews.map((r) => (
                        <View key={r.id} style={s.reviewItem}>
                            <View style={s.reviewMeta}>
                                <Text style={s.reviewStars}>{renderStars(r.rating)}</Text>
                                <Text style={s.reviewDate}>{new Date(r.reviewed_at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                            </View>
                            <Text style={s.reviewContent} numberOfLines={3}>{r.content}</Text>
                        </View>
                    ))
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

    profileHeader: { alignItems: 'center', paddingVertical: spacing.lg },
    avatarLarge: {
        width: 80, height: 80, borderRadius: 40,
        justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
    },
    avatarLargeText: { fontSize: fonts.sizes.hero, fontWeight: '700' },
    guestName: { color: colors.text.primary, fontSize: fonts.sizes.xxl, fontWeight: '700' },
    tierBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.full, marginTop: spacing.sm },
    tierText: { fontSize: fonts.sizes.sm, fontWeight: '700', letterSpacing: 1 },

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

    card: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, borderWidth: 1, borderColor: colors.border.subtle,
        marginBottom: spacing.md,
    },
    cardTitle: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600', marginBottom: spacing.sm },

    sentimentRow: { flexDirection: 'row', justifyContent: 'space-around', gap: spacing.sm },
    sentimentItem: { alignItems: 'center', gap: 4 },
    sentimentLabel: { color: colors.text.muted, fontSize: 10, textTransform: 'uppercase' },
    sentimentScore: { fontSize: fonts.sizes.lg, fontWeight: '700' },

    reviewsSection: { marginTop: spacing.md },
    sectionHeader: { color: colors.text.primary, fontSize: fonts.sizes.lg, fontWeight: '700', marginBottom: spacing.sm },
    reviewItem: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    reviewMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    reviewStars: { fontSize: 14, color: colors.accent.gold },
    reviewDate: { color: colors.text.muted, fontSize: 12 },
    reviewContent: { color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md, textAlign: 'center', marginTop: 20 },
});
