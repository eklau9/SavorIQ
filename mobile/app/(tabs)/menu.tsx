import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
    Alert, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import {
    fetchMenuItems, createMenuItem, deleteMenuItem, mergeMenuItems,
    extractMenuFromPhoto, SavedMenuItem, ExtractedMenuItem,
} from '@/lib/api';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';

export default function MenuScreen() {
    const { activeId } = useRestaurant();
    const { dashboardData, menuItems, setMenuItems } = useData();

    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'food' | 'drink'>('all');

    // Add item modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [newItemName, setNewItemName] = useState('');
    const [newItemCategory, setNewItemCategory] = useState<'food' | 'drink'>('food');
    const [addingItem, setAddingItem] = useState(false);

    // Scan state
    const [scanning, setScanning] = useState(false);
    const [extractedItems, setExtractedItems] = useState<ExtractedMenuItem[]>([]);
    const [selectedExtracted, setSelectedExtracted] = useState<Set<number>>(new Set());
    const [showScanResults, setShowScanResults] = useState(false);
    const [savingScanned, setSavingScanned] = useState(false);

    // Refresh menu items after mutations (add/delete/scan)
    const refreshMenuItems = useCallback(async () => {
        if (!activeId) return;
        try {
            const items = await fetchMenuItems();
            setMenuItems(items);
        } catch (e) {
            console.warn('Failed to refresh menu items:', e);
        }
    }, [activeId, setMenuItems]);

    // Performance data from dashboard analytics
    const topPerformers = dashboardData?.top_performers || [];
    const risks = dashboardData?.risks || [];

    // Build performance map: item name (lowercase) -> { mentions, positive_pct }
    const perfMap = new Map<string, { mentions: number; sentiment: 'positive' | 'negative' | 'neutral' }>();
    for (const p of topPerformers) {
        perfMap.set(p.item_name.toLowerCase(), { mentions: p.review_count, sentiment: 'positive' });
    }
    for (const r of risks) {
        const existing = perfMap.get(r.item_name.toLowerCase());
        if (existing) {
            existing.sentiment = 'neutral'; // Shows in both — mixed
        } else {
            perfMap.set(r.item_name.toLowerCase(), { mentions: r.review_count, sentiment: 'negative' });
        }
    }

    // Filter and search
    const filteredItems = menuItems.filter(item => {
        if (filter !== 'all' && item.category !== filter) return false;
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    // Add item handler
    const handleAddItem = async () => {
        if (!newItemName.trim()) return;
        setAddingItem(true);
        try {
            await createMenuItem(newItemName.trim(), newItemCategory);
            setNewItemName('');
            setShowAddModal(false);
            await refreshMenuItems();
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to add item');
        } finally {
            setAddingItem(false);
        }
    };

    // Delete item handler
    const handleDeleteItem = (item: SavedMenuItem) => {
        Alert.alert(
            'Remove Item',
            `Remove "${item.name}" from your menu?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove', style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteMenuItem(item.id);
                            setMenuItems(prev => prev.filter(i => i.id !== item.id));
                        } catch (e) {
                            Alert.alert('Error', 'Failed to remove item');
                        }
                    },
                },
            ]
        );
    };

    // Scan menu photo handler
    const handleScanMenu = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                base64: true,
                quality: 0.7,
            });

            if (result.canceled || !result.assets?.[0]?.base64) return;

            setScanning(true);
            const items = await extractMenuFromPhoto(result.assets[0].base64);
            setExtractedItems(items);
            setSelectedExtracted(new Set(items.map((_, i) => i)));
            setShowScanResults(true);
        } catch (e: any) {
            Alert.alert('Scan Failed', e.message || 'Could not extract items from photo');
        } finally {
            setScanning(false);
        }
    };

    // Save scanned items (merge)
    const handleSaveScanned = async () => {
        setSavingScanned(true);
        try {
            const itemsToAdd = extractedItems.filter((_, i) => selectedExtracted.has(i));
            await mergeMenuItems(itemsToAdd);
            setShowScanResults(false);
            setExtractedItems([]);
            setSelectedExtracted(new Set());
            await refreshMenuItems();
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to save items');
        } finally {
            setSavingScanned(false);
        }
    };

    const toggleExtractedItem = (index: number) => {
        setSelectedExtracted(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    // ─── Render ─────────────────────────────────────────────────────────

    return (
        <View style={s.container}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Header */}
            <View style={s.header}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                    <Text style={s.brandText}>SavorIQ</Text>
                </View>
                <Text style={s.title}>Menu</Text>
            </View>

            {menuItems.length === 0 ? (
                /* ── Empty State ── */
                <View style={s.emptyContainer}>
                    <View style={s.emptyCard}>
                        <Ionicons name="restaurant-outline" size={48} color={colors.accent.gold} style={{ marginBottom: spacing.md }} />
                        <Text style={s.emptyTitle}>No Menu Items Yet</Text>
                        <Text style={s.emptyDesc}>
                            Add or update your menu so SavorIQ can track which items customers love (or don't).
                        </Text>
                        <View style={s.emptyActions}>
                            <TouchableOpacity style={s.emptyBtn} onPress={handleScanMenu} disabled={scanning}>
                                {scanning ? (
                                    <ActivityIndicator size="small" color={colors.accent.gold} />
                                ) : (
                                    <>
                                        <Ionicons name="camera" size={20} color={colors.accent.gold} />
                                        <Text style={s.emptyBtnText}>Scan Menu</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowAddModal(true)}>
                                <Ionicons name="add-circle" size={20} color={colors.accent.gold} />
                                <Text style={s.emptyBtnText}>Add Item</Text>
                            </TouchableOpacity>
                        </View>
                        <Text style={s.emptyTip}>
                            💡 After your first sync, SavorIQ auto-discovers items from reviews.
                        </Text>
                    </View>
                </View>
            ) : (
                /* ── Item List ── */
                <>
                    {/* Search + Filter */}
                    <View style={s.controls}>
                        <View style={s.searchWrap}>
                            <Ionicons name="search" size={16} color={colors.text.muted} />
                            <TextInput
                                style={s.searchInput}
                                placeholder="Search items..."
                                placeholderTextColor={colors.text.muted}
                                value={search}
                                onChangeText={setSearch}
                            />
                        </View>
                        <View style={s.filterRow}>
                            {(['all', 'food', 'drink'] as const).map(f => (
                                <TouchableOpacity
                                    key={f}
                                    style={[s.filterPill, filter === f && s.filterPillActive]}
                                    onPress={() => setFilter(f)}
                                >
                                    <Text style={[s.filterText, filter === f && s.filterTextActive]}>
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 100 }}>
                        {filteredItems.map(item => {
                            const perf = perfMap.get(item.name.toLowerCase());
                            return (
                                <TouchableOpacity
                                    key={item.id}
                                    style={s.itemRow}
                                    onLongPress={() => handleDeleteItem(item)}
                                    activeOpacity={0.7}
                                >
                                    <View style={s.itemLeft}>
                                        <View style={s.itemNameRow}>
                                            <Text style={s.itemName}>{item.name}</Text>
                                            <View style={[s.categoryBadge, item.category === 'drink' && s.categoryDrink]}>
                                                <Text style={s.categoryText}>
                                                    {item.category.toUpperCase()}
                                                </Text>
                                            </View>
                                        </View>
                                        {perf ? (
                                            <View style={s.perfRow}>
                                                <Text style={s.perfMentions}>{perf.mentions} mentions</Text>
                                                <Text style={[
                                                    s.perfSentiment,
                                                    perf.sentiment === 'positive' && { color: colors.accent.green },
                                                    perf.sentiment === 'negative' && { color: '#FF6B6B' },
                                                ]}>
                                                    {perf.sentiment === 'positive' ? '🟢 Top Performer' :
                                                     perf.sentiment === 'negative' ? '🔴 At Risk' : '🟡 Mixed'}
                                                </Text>
                                            </View>
                                        ) : (
                                            <Text style={s.perfNone}>No mentions yet</Text>
                                        )}
                                    </View>
                                    <TouchableOpacity
                                        style={s.deleteBtn}
                                        onPress={() => handleDeleteItem(item)}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    >
                                        <Ionicons name="trash-outline" size={18} color={colors.text.muted} />
                                    </TouchableOpacity>
                                </TouchableOpacity>
                            );
                        })}
                        {filteredItems.length === 0 && (
                            <Text style={s.noResults}>No items match your search.</Text>
                        )}
                    </ScrollView>

                    {/* Floating Action Buttons */}
                    <View style={s.fab}>
                        <TouchableOpacity style={s.fabBtn} onPress={handleScanMenu} disabled={scanning}>
                            {scanning ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Ionicons name="camera" size={20} color="#fff" />
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity style={s.fabBtn} onPress={() => setShowAddModal(true)}>
                            <Ionicons name="add" size={24} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </>
            )}

            {/* ── Add Item Modal ── */}
            <Modal visible={showAddModal} transparent animationType="fade">
                <View style={s.modalOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>Add Menu Item</Text>
                        <TextInput
                            style={s.modalInput}
                            placeholder="Item name"
                            placeholderTextColor={colors.text.muted}
                            value={newItemName}
                            onChangeText={setNewItemName}
                            autoFocus
                        />
                        <View style={s.modalCategoryRow}>
                            <TouchableOpacity
                                style={[s.modalCategoryBtn, newItemCategory === 'food' && s.modalCategoryActive]}
                                onPress={() => setNewItemCategory('food')}
                            >
                                <Ionicons name="fast-food" size={16} color={newItemCategory === 'food' ? colors.accent.gold : colors.text.muted} />
                                <Text style={[s.modalCategoryText, newItemCategory === 'food' && { color: colors.accent.gold }]}>Food</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.modalCategoryBtn, newItemCategory === 'drink' && s.modalCategoryActive]}
                                onPress={() => setNewItemCategory('drink')}
                            >
                                <Ionicons name="wine" size={16} color={newItemCategory === 'drink' ? colors.accent.gold : colors.text.muted} />
                                <Text style={[s.modalCategoryText, newItemCategory === 'drink' && { color: colors.accent.gold }]}>Drink</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => { setShowAddModal(false); setNewItemName(''); }}>
                                <Text style={s.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.modalSave, !newItemName.trim() && { opacity: 0.4 }]}
                                onPress={handleAddItem}
                                disabled={!newItemName.trim() || addingItem}
                            >
                                {addingItem ? (
                                    <ActivityIndicator size="small" color="#000" />
                                ) : (
                                    <Text style={s.modalSaveText}>Add</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Scan Results Modal ── */}
            <Modal visible={showScanResults} transparent animationType="slide">
                <View style={s.modalOverlay}>
                    <View style={[s.modalCard, { maxHeight: '80%' }]}>
                        <Text style={s.modalTitle}>Extracted Items</Text>
                        <Text style={s.modalSubtitle}>
                            Select items to add to your menu. Duplicates will be skipped.
                        </Text>
                        <ScrollView style={{ maxHeight: 400 }}>
                            {extractedItems.map((item, i) => (
                                <TouchableOpacity
                                    key={i}
                                    style={s.extractedRow}
                                    onPress={() => toggleExtractedItem(i)}
                                >
                                    <Ionicons
                                        name={selectedExtracted.has(i) ? 'checkbox' : 'square-outline'}
                                        size={22}
                                        color={selectedExtracted.has(i) ? colors.accent.gold : colors.text.muted}
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.extractedName}>{item.name}</Text>
                                        <Text style={s.extractedCategory}>
                                            {item.category.toUpperCase()}
                                            {item.price ? ` · $${item.price.toFixed(2)}` : ''}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <View style={s.modalActions}>
                            <TouchableOpacity style={s.modalCancel} onPress={() => setShowScanResults(false)}>
                                <Text style={s.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.modalSave, selectedExtracted.size === 0 && { opacity: 0.4 }]}
                                onPress={handleSaveScanned}
                                disabled={selectedExtracted.size === 0 || savingScanned}
                            >
                                {savingScanned ? (
                                    <ActivityIndicator size="small" color="#000" />
                                ) : (
                                    <Text style={s.modalSaveText}>Add {selectedExtracted.size} Items</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.primary },

    header: {
        paddingTop: 32,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    brandText: {
        color: colors.accent.gold,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    title: {
        color: colors.text.primary,
        fontSize: 32,
        fontWeight: '800',
        letterSpacing: -0.5,
    },

    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    // ── Empty State ──
    emptyContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.md },
    emptyCard: {
        backgroundColor: colors.bg.card,
        borderRadius: radius.lg,
        padding: spacing.xl,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    emptyTitle: {
        color: colors.text.primary,
        fontSize: 20,
        fontWeight: '700',
        marginBottom: spacing.sm,
    },
    emptyDesc: {
        color: colors.text.secondary,
        fontSize: fonts.sizes.sm,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: spacing.lg,
    },
    emptyActions: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.lg,
    },
    emptyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.accent.gold + '15',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.accent.gold + '30',
    },
    emptyBtnText: {
        color: colors.accent.gold,
        fontSize: fonts.sizes.sm,
        fontWeight: '700',
    },
    emptyTip: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        textAlign: 'center',
    },

    // ── Controls ──
    controls: { paddingHorizontal: spacing.md },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.bg.card,
        borderRadius: radius.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        marginBottom: spacing.sm,
    },
    searchInput: {
        flex: 1,
        color: colors.text.primary,
        fontSize: fonts.sizes.sm,
    },
    filterRow: {
        flexDirection: 'row',
        gap: spacing.xs,
        marginBottom: spacing.sm,
    },
    filterPill: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: colors.bg.card,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    filterPillActive: {
        backgroundColor: colors.accent.gold + '20',
        borderColor: colors.accent.gold + '40',
    },
    filterText: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        fontWeight: '600',
    },
    filterTextActive: {
        color: colors.accent.gold,
    },

    // ── Item List ──
    list: { flex: 1, paddingHorizontal: spacing.md },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.bg.card,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    itemLeft: { flex: 1 },
    itemNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    itemName: {
        color: colors.text.primary,
        fontSize: fonts.sizes.md,
        fontWeight: '600',
    },
    categoryBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: colors.accent.gold + '15',
    },
    categoryDrink: {
        backgroundColor: colors.accent.blue + '15',
    },
    categoryText: {
        fontSize: 9,
        fontWeight: '800',
        color: colors.accent.gold,
        letterSpacing: 0.5,
    },
    perfRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    perfMentions: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
    },
    perfSentiment: {
        fontSize: fonts.sizes.xs,
        fontWeight: '600',
    },
    perfNone: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        fontStyle: 'italic',
    },
    deleteBtn: {
        padding: 8,
    },
    noResults: {
        color: colors.text.muted,
        fontSize: fonts.sizes.sm,
        textAlign: 'center',
        marginTop: spacing.xl,
    },

    // ── FAB ──
    fab: {
        position: 'absolute',
        bottom: 24,
        right: spacing.md,
        flexDirection: 'row',
        gap: 12,
    },
    fabBtn: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.accent.gold,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },

    // ── Modals ──
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
    },
    modalCard: {
        backgroundColor: colors.bg.card,
        borderRadius: radius.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    modalTitle: {
        color: colors.text.primary,
        fontSize: 20,
        fontWeight: '700',
        marginBottom: spacing.sm,
    },
    modalSubtitle: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        marginBottom: spacing.md,
    },
    modalInput: {
        backgroundColor: colors.bg.secondary,
        borderRadius: radius.md,
        padding: spacing.md,
        color: colors.text.primary,
        fontSize: fonts.sizes.md,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        marginBottom: spacing.md,
    },
    modalCategoryRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    modalCategoryBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: radius.md,
        backgroundColor: colors.bg.secondary,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    modalCategoryActive: {
        borderColor: colors.accent.gold + '60',
        backgroundColor: colors.accent.gold + '10',
    },
    modalCategoryText: {
        color: colors.text.muted,
        fontSize: fonts.sizes.sm,
        fontWeight: '600',
    },
    modalActions: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    modalCancel: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: radius.md,
        alignItems: 'center',
        backgroundColor: colors.bg.secondary,
        borderWidth: 1,
        borderColor: colors.border.subtle,
    },
    modalCancelText: {
        color: colors.text.secondary,
        fontWeight: '600',
    },
    modalSave: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: radius.md,
        alignItems: 'center',
        backgroundColor: colors.accent.gold,
    },
    modalSaveText: {
        color: '#000',
        fontWeight: '700',
    },

    // ── Extracted Items ──
    extractedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.subtle,
    },
    extractedName: {
        color: colors.text.primary,
        fontSize: fonts.sizes.md,
        fontWeight: '600',
    },
    extractedCategory: {
        color: colors.text.muted,
        fontSize: fonts.sizes.xs,
        marginTop: 2,
    },
});
