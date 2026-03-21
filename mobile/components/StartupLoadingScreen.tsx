import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';

interface StartupLoadingScreenProps {
    progress?: number;
    loadingStep?: string;
    estimatedSecondsRemaining?: number;
    onSkip?: () => void;
}

export const StartupLoadingScreen: React.FC<StartupLoadingScreenProps> = ({
    progress = 0,
    loadingStep = '',
    onSkip,
}) => {
    const [showSkip, setShowSkip] = useState(false);
    const skipFadeAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(0.6)).current;

    // Animate progress bar
    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: progress / 100,
            duration: 400,
            useNativeDriver: false,
        }).start();
    }, [progress, progressAnim]);

    // Pulse the logo
    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
            ])
        ).start();
    }, [pulseAnim]);

    // Show skip button after 1.5 seconds
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowSkip(true);
            Animated.timing(skipFadeAnim, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }).start();
        }, 1500);
        return () => clearTimeout(timer);
    }, [skipFadeAnim]);

    return (
        <View style={s.container}>
            <View style={s.center}>
                {/* Logo */}
                <Animated.View style={[s.logoRow, { opacity: pulseAnim }]}>
                    <Ionicons name="sparkles" size={28} color={colors.accent.gold} />
                    <Text style={s.logoText}>
                        Savor<Text style={s.logoAccent}>IQ</Text>
                    </Text>
                </Animated.View>

                {/* Status */}
                <Text style={s.statusText}>
                    {loadingStep || 'Loading intelligence...'}
                </Text>

                {/* Progress bar */}
                <View style={s.progressTrack}>
                    <Animated.View
                        style={[
                            s.progressFill,
                            {
                                width: progressAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['0%', '100%'],
                                }),
                            },
                        ]}
                    />
                </View>
                <Text style={s.progressPercent}>
                    {progress.toFixed(2)}%
                </Text>
            </View>

            {/* Skip button */}
            <View style={s.footer}>
                {showSkip && onSkip ? (
                    <Animated.View style={{ opacity: skipFadeAnim }}>
                        <TouchableOpacity style={s.skipButton} onPress={onSkip} activeOpacity={0.7}>
                            <Text style={s.skipButtonText}>Skip</Text>
                            <Ionicons name="arrow-forward" size={14} color={colors.accent.gold} />
                        </TouchableOpacity>
                    </Animated.View>
                ) : null}
            </View>
        </View>
    );
};

const s = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg.primary,
        justifyContent: 'center',
    },
    center: {
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: spacing.lg,
    },
    logoText: {
        fontSize: 32,
        fontWeight: '800',
        color: colors.text.primary,
        letterSpacing: -0.5,
    },
    logoAccent: {
        color: colors.accent.gold,
    },
    statusText: {
        color: colors.text.muted,
        fontSize: fonts.sizes.sm,
        marginBottom: spacing.lg,
        textAlign: 'center',
    },
    progressTrack: {
        width: '60%',
        height: 3,
        backgroundColor: colors.border.subtle,
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.accent.gold,
        borderRadius: 2,
    },
    progressPercent: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        marginTop: spacing.sm,
        fontVariant: ['tabular-nums'],
    },
    footer: {
        position: 'absolute',
        bottom: 60,
        left: 0,
        right: 0,
        alignItems: 'center',
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
