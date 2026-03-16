import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

interface PlatformResult {
    platform: string;
    status: string;
    message?: string;
    new_ingested?: number;
}

interface SyncReportOverlayProps {
    visible: boolean;
    results: PlatformResult[];
    onClose: () => void;
}

export const SyncReportOverlay: React.FC<SyncReportOverlayProps> = ({
    visible,
    results,
    onClose
}) => {
    const renderResult = (res: PlatformResult) => {
        const platformName = res.platform.charAt(0).toUpperCase() + res.platform.slice(1);
        let iconName: any = "checkmark-circle";
        let iconColor = "#34C759";
        let statusText = `${res.new_ingested ?? 0} new reviews`;

        if (res.status === 'error') {
            iconName = "alert-circle";
            iconColor = "#FF3B30";
            statusText = res.message || 'Sync failed';
        } else if (res.status === 'skipped') {
            iconName = "play-skip-forward-circle";
            iconColor = "#FF9500";
            statusText = res.message || 'Already synced';
        } else if (res.status === 'cancelled') {
            iconName = "stop-circle";
            iconColor = "#8E8E93";
            statusText = "Sync cancelled";
        }

        return (
            <View key={res.platform} style={styles.resultItem}>
                <Ionicons name={iconName} size={24} color={iconColor} style={styles.resultIcon} />
                <View style={styles.resultTextContainer}>
                    <Text style={styles.platformName}>{platformName}</Text>
                    <Text style={styles.platformStatus}>{statusText}</Text>
                </View>
            </View>
        );
    };

    return (
        <Modal transparent visible={visible} animationType="fade">
            <BlurView intensity={80} style={StyleSheet.absoluteFill} tint="dark">
                <View style={styles.container}>
                    <View style={styles.card}>
                        <View style={styles.header}>
                            <Ionicons name="checkbox" size={28} color="#007AFF" style={{ marginRight: 12 }} />
                            <Text style={styles.title}>Sync Complete</Text>
                        </View>
                        
                        <Text style={styles.subtitle}>Review Synchronization Results</Text>
                        
                        <ScrollView style={styles.resultsList} showsVerticalScrollIndicator={false}>
                            {results.map(renderResult)}
                        </ScrollView>

                        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                            <Text style={styles.closeButtonText}>Done</Text>
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
        padding: 24,
    },
    card: {
        backgroundColor: '#1C1C1E',
        borderRadius: 24,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        maxHeight: '80%',
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
        marginBottom: 4,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    subtitle: {
        fontSize: 14,
        color: '#8E8E93',
        marginBottom: 24,
    },
    resultsList: {
        marginBottom: 24,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2C2C2E',
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#38383A',
    },
    resultIcon: {
        marginRight: 16,
    },
    resultTextContainer: {
        flex: 1,
    },
    platformName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 2,
    },
    platformStatus: {
        fontSize: 13,
        color: '#A1A1A6',
    },
    closeButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    closeButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
