import React from 'react';
import { View, Text, StyleSheet, Modal, ActivityIndicator, TouchableOpacity, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

interface SyncProgressOverlayProps {
    visible: boolean;
    percent: number;
    status: string;
    processedCount?: number;
    totalCount?: number;
    estimatedSecondsRemaining?: number;
    onCancel: () => void;
    onClose?: () => void;
}

export const SyncProgressOverlay: React.FC<SyncProgressOverlayProps> = ({
    visible,
    percent,
    status,
    processedCount,
    totalCount,
    estimatedSecondsRemaining,
    onCancel,
    onClose,
}) => {
    const progressAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: percent,
            duration: 500,
            useNativeDriver: false,
        }).start();
    }, [percent]);

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
        <Modal transparent visible={visible} animationType="fade">
            <BlurView intensity={80} style={StyleSheet.absoluteFill} tint="dark">
                <View style={styles.container}>
                    <View style={styles.card}>
                        <View style={styles.header}>
                            {percent < 100 && (
                                <ActivityIndicator color="#007AFF" style={{ marginRight: 10 }} />
                            )}
                            <Text style={styles.title}>Synchronizing Data</Text>
                        </View>
                        {/* Platform status rows */}
                        <View style={styles.platformRows}>
                            {(percent === 100
                                ? [status || 'Sync Complete!']
                                : (status || '').split(' • ')
                            ).map((line, idx) => {
                                const isGoogle = line.startsWith('Google:');
                                const isYelp = line.startsWith('Yelp:');
                                const isDone = line.includes('✓');
                                return (
                                    <View key={idx} style={styles.platformRow}>
                                        <Ionicons 
                                            name={isGoogle ? 'logo-google' : isYelp ? 'star' : 'sync'} 
                                            size={14} 
                                            color={isDone ? '#34C759' : '#A1A1A6'}
                                            style={{ marginRight: 6, marginTop: 1 }} 
                                        />
                                        <Text style={[styles.status, isDone && { color: '#34C759' }]}>{line}</Text>
                                    </View>
                                );
                            })}
                        </View>
                        
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
                                <View>
                                    <Text style={styles.percentText}>{percent}% Complete</Text>
                                </View>
                                {estimatedSecondsRemaining && percent < 100 ? (
                                    <Text style={styles.estimateText}>{formatTime(estimatedSecondsRemaining)}</Text>
                                ) : null}
                            </View>
                            {totalCount && totalCount > 0 && percent < 100 ? (
                                <View style={styles.countsRow}>
                                    <Text style={styles.countText}>
                                        {processedCount || 0} / {totalCount} reviews analyzed
                                    </Text>
                                </View>
                            ) : null}
                        </View>

                        <TouchableOpacity 
                            style={[
                                styles.cancelButton, 
                                percent === 100 && styles.doneButton
                            ]} 
                            onPress={percent === 100 ? (onClose || onCancel) : onCancel}
                        >
                            <Ionicons 
                                name={percent === 100 ? "checkmark-circle" : "close-circle"} 
                                size={20} 
                                color={percent === 100 ? "#34C759" : "#FF3B30"} 
                                style={{ marginRight: 6 }} 
                            />
                            <Text style={[styles.cancelText, percent === 100 && { color: "#34C759" }]}>
                                {percent === 100 ? "Close" : "Cancel Sync"}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </BlurView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    card: {
        backgroundColor: '#1C1C1E',
        borderRadius: 20,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
        borderWidth: 1,
        borderColor: '#38383A',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    status: {
        fontSize: 14,
        color: '#A1A1A6',
    },
    platformRows: {
        marginBottom: 20,
        gap: 6,
    },
    platformRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    progressContainer: {
        marginBottom: 24,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
    },
    progressBarBackground: {
        height: 12,
        backgroundColor: '#38383A',
        borderRadius: 6,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#007AFF', // Premium blue
        borderRadius: 6,
    },
    percentText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    estimateText: {
        fontSize: 12,
        color: '#A1A1A6',
    },
    countText: {
        fontSize: 10,
        color: '#A1A1A6',
        marginTop: 2,
    },
    countsRow: {
        marginTop: 4,
    },
    cancelButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 59, 48, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255, 59, 48, 0.2)',
    },
    cancelText: {
        color: '#FF3B30',
        fontWeight: '600',
        fontSize: 14,
    },
    doneButton: {
        backgroundColor: 'rgba(52, 199, 89, 0.1)',
        borderColor: 'rgba(52, 199, 89, 0.2)',
    },
});
