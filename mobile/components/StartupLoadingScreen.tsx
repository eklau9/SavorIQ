import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';

interface StartupLoadingScreenProps {
    progress: number;
    loadingStep: string;
    estimatedSecondsRemaining?: number;
}

export const StartupLoadingScreen: React.FC<StartupLoadingScreenProps> = ({
    progress,
    loadingStep,
    estimatedSecondsRemaining,
}) => {
    const progressAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: progress,
            duration: 500,
            useNativeDriver: false,
        }).start();
    }, [progress]);

    const formatTime = (seconds?: number) => {
        if (!seconds || seconds <= 0) return null;
        if (seconds < 60) return `${seconds}s remaining`;
        const mins = Math.ceil(seconds / 60);
        return `~${mins} ${mins === 1 ? 'min' : 'mins'} remaining`;
    };

    const widthInterpolation = progressAnim.interpolate({
        inputRange: [0, 100],
        outputRange: ['0%', '100%'],
    });

    return (
        <View style={styles.container}>
            <View style={styles.background}>
                 <View style={styles.brandingContainer}>
                    <Ionicons name="sparkles" size={64} color={colors.accent.gold} />
                    <Text style={styles.brandTitle}>SavorIQ</Text>
                    <Text style={styles.brandSubtitle}>Intelligence Hub</Text>
                 </View>
            </View>

            <View style={styles.cardContainer}>
                <BlurView intensity={20} style={styles.card} tint="dark">
                    <View style={styles.header}>
                        <ActivityIndicator color={colors.accent.gold} style={{ marginRight: 10 }} />
                        <Text style={styles.title}>Synchronizing Dashboard</Text>
                    </View>
                    
                    <Text style={styles.status}>{loadingStep || 'Connecting to server...'}</Text>
                    
                    <View style={styles.progressContainer}>
                        <View style={styles.progressBarBackground}>
                            <Animated.View 
                                style={[
                                    styles.progressBarFill, 
                                    { width: widthInterpolation }
                                ]} 
                            />
                        </View>
                        <View style={styles.progressHeader}>
                            <Text style={styles.percentText}>{Math.floor(progress)}% Complete</Text>
                            {estimatedSecondsRemaining ? (
                                <Text style={styles.estimateText}>{formatTime(estimatedSecondsRemaining)}</Text>
                            ) : null}
                        </View>
                    </View>
                </BlurView>
            </View>

            <Text style={styles.footerText}>Optimizing intelligence engine for your restaurant...</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg.primary,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    background: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: 0.05,
    },
    brandingContainer: {
        alignItems: 'center',
    },
    brandTitle: {
        color: colors.text.primary,
        fontSize: 56,
        fontWeight: '900',
        letterSpacing: -2,
        marginTop: spacing.md,
    },
    brandSubtitle: {
        color: colors.accent.gold,
        fontSize: fonts.sizes.sm,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 6,
        marginTop: -spacing.xs,
    },
    cardContainer: {
        width: '100%',
        maxWidth: 400,
        borderRadius: radius.xl,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border.default,
        backgroundColor: colors.bg.secondary + '40',
    },
    card: {
        padding: spacing.xl,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    title: {
        fontSize: fonts.sizes.lg,
        fontWeight: 'bold',
        color: colors.text.primary,
    },
    status: {
        fontSize: fonts.sizes.sm,
        color: colors.text.secondary,
        marginBottom: spacing.xl,
    },
    progressContainer: {
        marginBottom: spacing.sm,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: spacing.sm,
    },
    progressBarBackground: {
        height: 8,
        backgroundColor: colors.bg.secondary,
        borderRadius: radius.full,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: colors.accent.gold,
        borderRadius: radius.full,
    },
    percentText: {
        fontSize: fonts.sizes.xs,
        fontWeight: '700',
        color: colors.text.primary,
    },
    estimateText: {
        fontSize: fonts.sizes.xs,
        color: colors.text.muted,
    },
    footerText: {
        position: 'absolute',
        bottom: 60,
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        textAlign: 'center',
        width: '100%',
    }
});
