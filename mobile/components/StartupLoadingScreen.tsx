import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';

interface StartupLoadingScreenProps {
    progress: number;
    loadingStep: string;
    estimatedSecondsRemaining?: number;
    onSkip?: () => void;
}

const ShimmerBlock = ({ width, height, style, borderRadius = radius.sm }: any) => {
    const pulseAnim = useRef(new Animated.Value(0.3)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 0.7,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0.3,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, [pulseAnim]);

    return (
        <Animated.View
            style={[
                {
                    width,
                    height,
                    backgroundColor: colors.bg.secondary,
                    borderRadius,
                    opacity: pulseAnim,
                },
                style,
            ]}
        />
    );
};

export const StartupLoadingScreen: React.FC<StartupLoadingScreenProps> = ({ onSkip }) => {
    const [showSkip, setShowSkip] = useState(false);
    const skipFadeAnim = useRef(new Animated.Value(0)).current;

    // Show skip button after 3.5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowSkip(true);
            Animated.timing(skipFadeAnim, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }).start();
        }, 3500);
        return () => clearTimeout(timer);
    }, [skipFadeAnim]);

    return (
        <View style={s.container}>
            <View style={s.content}>
                {/* Header Section */}
                <View style={s.headerRow}>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                                <ShimmerBlock width={60} height={14} />
                            </View>
                            <ShimmerBlock width={40} height={14} />
                        </View>
                        <ShimmerBlock width={'70%'} height={38} style={{ marginTop: 2, marginBottom: 8 }} />
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
                            <ShimmerBlock width={120} height={20} borderRadius={radius.full} />
                            <ShimmerBlock width={160} height={24} borderRadius={radius.sm} />
                        </View>
                    </View>
                </View>

                {/* KPI Row */}
                <View style={s.kpiRow}>
                    {[1, 2, 3].map((i) => (
                        <View key={i} style={s.kpiCard}>
                            <ShimmerBlock width={16} height={16} style={{ marginBottom: 4 }} />
                            <ShimmerBlock width={40} height={28} style={{ marginBottom: 4 }} />
                            <ShimmerBlock width={50} height={12} />
                        </View>
                    ))}
                </View>

                {/* Manager Briefing Card */}
                <View style={s.card}>
                    <View style={s.cardHeader}>
                        <Ionicons name="sparkles" size={18} color={colors.accent.gold} />
                        <ShimmerBlock width={140} height={22} />
                    </View>
                    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
                        <ShimmerBlock width={'100%'} height={16} />
                        <ShimmerBlock width={'90%'} height={16} />
                        <ShimmerBlock width={'95%'} height={16} />
                    </View>

                    {/* Insights List */}
                    {[1, 2, 3].map((i) => (
                        <View key={i} style={s.insightRow}>
                            <ShimmerBlock width={32} height={32} borderRadius={radius.sm} />
                            <View style={s.insightContent}>
                                <ShimmerBlock width={'60%'} height={18} style={{ marginBottom: 4 }} />
                                <ShimmerBlock width={'100%'} height={14} style={{ marginBottom: 2 }} />
                                <ShimmerBlock width={'80%'} height={14} />
                            </View>
                        </View>
                    ))}
                </View>

                {/* Top Performing Items Skeleton */}
                <View style={s.card}>
                    <View style={s.cardHeader}>
                        <Ionicons name="trending-up" size={18} color={colors.sentiment.positive} />
                        <ShimmerBlock width={160} height={20} />
                    </View>
                    {[1, 2].map((i) => (
                         <View key={i} style={s.itemRow}>
                             <View style={{ flex: 1 }}>
                                  <ShimmerBlock width={'70%'} height={18} style={{ marginBottom: 4 }} />
                                  <ShimmerBlock width={'30%'} height={12} />
                             </View>
                             <View style={s.itemStats}>
                                  <ShimmerBlock width={24} height={24} style={{ marginBottom: 2 }} />
                                  <ShimmerBlock width={40} height={10} />
                             </View>
                             <View style={{ marginLeft: spacing.sm }}>
                                  <ShimmerBlock width={60} height={20} borderRadius={radius.sm} />
                             </View>
                         </View>
                    ))}
                </View>
                
                 {/* At-Risk Items Skeleton */}
                 <View style={s.card}>
                    <View style={s.cardHeader}>
                        <Ionicons name="trending-down" size={18} color={colors.accent.red} />
                        <ShimmerBlock width={120} height={20} />
                    </View>
                    {[1].map((i) => (
                         <View key={i} style={[s.itemRow, { borderBottomWidth: 0, paddingBottom: 0 }]} >
                             <View style={{ flex: 1 }}>
                                  <ShimmerBlock width={'80%'} height={18} style={{ marginBottom: 4 }} />
                                  <ShimmerBlock width={'40%'} height={12} />
                             </View>
                             <View style={s.itemStats}>
                                  <ShimmerBlock width={24} height={24} style={{ marginBottom: 2 }} />
                                  <ShimmerBlock width={40} height={10} />
                             </View>
                             <View style={{ marginLeft: spacing.sm }}>
                                  <ShimmerBlock width={60} height={20} borderRadius={radius.sm} />
                             </View>
                         </View>
                    ))}
                </View>
            </View>
            <View style={s.footerOverlay}>
                  {showSkip && onSkip ? (
                      <Animated.View style={{ opacity: skipFadeAnim, alignItems: 'center' }}>
                          <TouchableOpacity style={s.skipButton} onPress={onSkip} activeOpacity={0.7}>
                              <Text style={s.skipButtonText}>Skip</Text>
                              <Ionicons name="arrow-forward" size={14} color={colors.accent.gold} />
                          </TouchableOpacity>
                      </Animated.View>
                  ) : (
                      <Text style={s.footerText}>Optimizing intelligence engine for your restaurant...</Text>
                  )}
            </View>
        </View>
    );
};

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },
    content: { padding: spacing.md, paddingTop: 32, paddingBottom: 40 },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 32,
        marginBottom: spacing.md,
        paddingHorizontal: spacing.xs,
    },
    kpiRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    kpiCard: {
        flex: 1, backgroundColor: colors.bg.card, borderRadius: radius.md,
        padding: spacing.md, alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: colors.border.subtle,
    },
    card: {
        backgroundColor: colors.bg.card, borderRadius: radius.lg,
        padding: spacing.md, marginBottom: spacing.md,
        borderWidth: 1, borderColor: colors.border.subtle,
        overflow: 'hidden'
    },
    cardHeader: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginBottom: spacing.md, paddingBottom: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
    },
    insightRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    insightContent: { flex: 1, justifyContent: 'center' },
    itemRow: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
    },
    itemStats: { alignItems: 'center' },
    footerOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 100,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(5, 7, 10, 0.8)',
    },
    footerText: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        textAlign: 'center',
    },
    skipButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.accent.gold + '50',
        backgroundColor: colors.accent.gold + '10',
    },
    skipButtonText: {
        color: colors.accent.gold,
        fontSize: fonts.sizes.sm,
        fontWeight: '600',
    },
});
