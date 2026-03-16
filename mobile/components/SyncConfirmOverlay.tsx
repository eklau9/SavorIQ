import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

interface SyncConfirmOverlayProps {
    visible: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const SyncConfirmOverlay: React.FC<SyncConfirmOverlayProps> = ({
    visible,
    title,
    message,
    onConfirm,
    onCancel
}) => {
    return (
        <Modal transparent visible={visible} animationType="fade">
            <BlurView intensity={80} style={StyleSheet.absoluteFill} tint="dark">
                <View style={styles.container}>
                    <View style={styles.card}>
                        <View style={styles.header}>
                            <View style={styles.iconContainer}>
                                <Ionicons name="sync" size={32} color="#007AFF" />
                            </View>
                            <Text style={styles.title}>{title}</Text>
                        </View>
                        
                        <Text style={styles.message}>{message}</Text>
                        
                        <View style={styles.footer}>
                            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.confirmButton} onPress={onConfirm}>
                                <Text style={styles.confirmButtonText}>Sync Now</Text>
                            </TouchableOpacity>
                        </View>
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
        borderWidth: 1,
        borderColor: '#38383A',
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#FFFFFF',
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        color: '#A1A1A6',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    footer: {
        flexDirection: 'row',
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: '#2C2C2E',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: '#007AFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
