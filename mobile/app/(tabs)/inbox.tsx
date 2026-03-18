import React, { useState, useCallback } from 'react';
import {
    View, Text, FlatList, StyleSheet, RefreshControl,
    ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import { fetchGuestPriorities, postInterceptAction, GuestPrioritized } from '@/lib/api';
import NoRestaurantSelected from '@/components/NoRestaurantSelected';

export default function InboxScreen() {
    const { activeId, loading: contextLoading } = useRestaurant();
    const { priorities: globalPriorities, refreshAll, loading: dataLoading } = useData();
    const [refreshing, setRefreshing] = useState(false);

    useFocusEffect(
        useCallback(() => {
            if (activeId) {
                refreshAll();
            }
        }, [activeId, refreshAll])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await refreshAll();
        setRefreshing(false);
    };

    const handleAction = async (guestId: string, action: string) => {
        try {
            await postInterceptAction(guestId, { action });
            refreshAll(); // Refresh data after action
        } catch (e) {
            console.error('Action error:', e);
        }
    };

    const statusColor = (status: string | null) => {
        switch (status) {
            case 'open': return colors.accent.red;
            case 'actioned': return colors.accent.gold;
            case 'resolved': return colors.accent.green;
            default: return colors.text.muted;
        }
    };

    const renderItem = ({ item }: { item: GuestPrioritized }) => {
        const guest = item.guest;
        const initial = guest?.name ? guest.name.charAt(0).toUpperCase() : '?';

        return (
            <View style={s.card}>
                <View style={s.cardHeader}>
                    <View style={s.avatarCircle}>
                        <Text style={s.avatarText}>{initial}</Text>
                    </View>
                    <View style={s.headerInfo}>
                        <Text style={s.guestName}>{guest?.name || 'Anonymous'}</Text>
                        <Text style={s.guestMeta}>
                            {item.review_count} review{item.review_count !== 1 ? 's' : ''}
                            {' · '}
                            {item.last_visit_days_ago} days ago
                        </Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: statusColor(item.current_status) + '20' }]}>
                        <View style={[s.statusDot, { backgroundColor: statusColor(item.current_status) }]} />
                        <Text style={[s.statusText, { color: statusColor(item.current_status) }]}>
                            {item.current_status || 'open'}
                        </Text>
                    </View>
                </View>

                {/* Priority Insight */}
                <View style={s.insightBox}>
                    <Text style={s.reasonText}>{item.reason}</Text>
                    <Text style={s.actionText}>{item.recommended_action}</Text>
                </View>

                {/* Action Buttons */}
                {item.current_status !== 'resolved' && item.current_status !== 'dismissed' && (
                    <View style={s.actionRow}>
                        <TouchableOpacity
                            style={[s.actionBtn, { backgroundColor: colors.accent.green + '15' }]}
                            onPress={() => handleAction(guest.id, 'resolved')}
                        >
                            <Ionicons name="checkmark-circle" size={16} color={colors.accent.green} />
                            <Text style={[s.actionBtnText, { color: colors.accent.green }]}>Resolve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[s.actionBtn, { backgroundColor: colors.accent.red + '15' }]}
                            onPress={() => handleAction(guest.id, 'dismissed')}
                        >
                            <Ionicons name="close-circle" size={16} color={colors.accent.red} />
                            <Text style={[s.actionBtnText, { color: colors.accent.red }]}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    const isLoading = contextLoading || (dataLoading && globalPriorities.length === 0);

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
                        <Text style={s.pageTitle}>Inbox</Text>
                    </View>

                    <Text style={s.subtitle}>
                        {globalPriorities.length} guest{globalPriorities.length !== 1 ? 's' : ''} need attention
                    </Text>

                    {isLoading ? (
                        <View style={s.center}>
                            <ActivityIndicator size="large" color={colors.accent.gold} />
                        </View>
                    ) : (
                        <FlatList
                            data={globalPriorities}
                            renderItem={renderItem}
                            keyExtractor={(item) => String(item.guest.id)}
                            contentContainerStyle={s.list}
                            refreshControl={
                                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.gold} />
                            }
                            ListEmptyComponent={
                                <View style={s.emptyContainer}>
                                    <Ionicons name="checkmark-done-circle" size={48} color={colors.accent.green} />
                                    <Text style={s.emptyTitle}>All Clear!</Text>
                                    <Text style={s.emptyText}>No guests need attention right now.</Text>
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
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: spacing.md, paddingBottom: 40 },

    subtitle: {
        color: colors.text.muted, fontSize: fonts.sizes.sm,
        padding: spacing.md, paddingBottom: 0,
    },

    card: {
        backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatarCircle: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: colors.accent.red + '20',
        justifyContent: 'center', alignItems: 'center',
    },
    avatarText: { color: colors.accent.red, fontSize: fonts.sizes.lg, fontWeight: '700' },
    headerInfo: { flex: 1 },
    guestName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
    guestMeta: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },

    insightBox: {
        marginTop: spacing.md,
        padding: spacing.sm,
        backgroundColor: colors.bg.primary,
        borderRadius: radius.sm,
    },
    reasonText: { color: colors.text.secondary, fontSize: fonts.sizes.sm, fontWeight: '600' },
    actionText: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 4 },

    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
    },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: fonts.sizes.xs, fontWeight: '600', textTransform: 'capitalize' },

    actionRow: {
        flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md,
        borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: spacing.sm,
    },
    actionBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, borderRadius: radius.sm,
    },
    actionBtnText: { fontSize: fonts.sizes.sm, fontWeight: '600' },

    emptyContainer: { alignItems: 'center', paddingTop: 80, gap: spacing.sm },
    emptyTitle: { color: colors.text.primary, fontSize: fonts.sizes.xl, fontWeight: '700' },
    emptyText: { color: colors.text.muted, fontSize: fonts.sizes.md },
});
