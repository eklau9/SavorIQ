import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { extractMenuFromPhoto, bulkAddMenuItems, ExtractedMenuItem } from '@/lib/api';

type EditableItem = ExtractedMenuItem & { selected: boolean };

export default function MenuUploadScreen() {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [hasExtracted, setHasExtracted] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to take menu photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]?.base64) {
      await extractItems(result.assets[0].base64);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to take menu photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]?.base64) {
      await extractItems(result.assets[0].base64);
    }
  };

  const extractItems = async (base64: string) => {
    setExtracting(true);
    try {
      const extracted = await extractMenuFromPhoto(base64);
      setItems(extracted.map(item => ({ ...item, selected: true })));
      setHasExtracted(true);
    } catch (e: any) {
      Alert.alert('Extraction Failed', e.message || 'Could not extract menu items from this photo.');
    } finally {
      setExtracting(false);
    }
  };

  const toggleItem = (idx: number) => {
    setItems(prev => prev.map((item, i) => 
      i === idx ? { ...item, selected: !item.selected } : item
    ));
  };

  const updateItemName = (idx: number, name: string) => {
    setItems(prev => prev.map((item, i) => 
      i === idx ? { ...item, name } : item
    ));
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const saveItems = async () => {
    const selected = items.filter(i => i.selected);
    if (selected.length === 0) {
      Alert.alert('No Items', 'Please select at least one item to save.');
      return;
    }

    setSaving(true);
    try {
      const toSave: ExtractedMenuItem[] = selected.map(({ selected: _, ...rest }) => rest);
      await bulkAddMenuItems(toSave);
      Alert.alert(
        'Menu Saved!',
        `${selected.length} items saved. Your dashboard will now show exact menu item performance.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (e: any) {
      Alert.alert('Save Failed', e.message || 'Could not save menu items.');
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = items.filter(i => i.selected).length;
  const foodCount = items.filter(i => i.selected && i.category === 'food').length;
  const drinkCount = items.filter(i => i.selected && i.category === 'drink').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg.primary }}>
      <Stack.Screen options={{
        headerShown: true,
        title: 'Upload Menu',
        headerStyle: { backgroundColor: colors.bg.primary },
        headerTintColor: colors.text.primary,
        headerBackTitle: 'Back',
      }} />
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        
        {/* Upload Section */}
        {!hasExtracted && !extracting && (
          <View style={s.uploadCard}>
            <Ionicons name="restaurant" size={48} color={colors.accent.gold} />
            <Text style={s.uploadTitle}>Add Your Menu</Text>
            <Text style={s.uploadSubtitle}>
              Take a photo or select an image of your menu.{'\n'}
              AI will extract every item automatically.
            </Text>
            <View style={s.btnRow}>
              <TouchableOpacity style={s.uploadBtn} onPress={takePhoto}>
                <Ionicons name="camera" size={20} color={colors.bg.primary} />
                <Text style={s.uploadBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.uploadBtn, s.uploadBtnOutline]} onPress={pickImage}>
                <Ionicons name="images" size={20} color={colors.accent.gold} />
                <Text style={[s.uploadBtnText, { color: colors.accent.gold }]}>Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Extracting State */}
        {extracting && (
          <View style={s.uploadCard}>
            <ActivityIndicator size="large" color={colors.accent.gold} />
            <Text style={s.uploadTitle}>Analyzing Menu...</Text>
            <Text style={s.uploadSubtitle}>
              Gemini Vision is extracting your menu items.{'\n'}This usually takes 5-10 seconds.
            </Text>
          </View>
        )}

        {/* Extracted Items */}
        {hasExtracted && !extracting && (
          <>
            {/* Summary Bar */}
            <View style={s.summaryBar}>
              <Text style={s.summaryText}>
                {selectedCount} items selected
                <Text style={{ color: colors.text.muted }}> ({foodCount} food, {drinkCount} drink)</Text>
              </Text>
              <TouchableOpacity onPress={pickImage}>
                <Text style={{ color: colors.accent.blue, fontSize: fonts.sizes.xs, fontWeight: '600' }}>+ Add More</Text>
              </TouchableOpacity>
            </View>

            {/* Item List */}
            {items.map((item, idx) => (
              <View key={idx} style={[s.itemCard, !item.selected && s.itemCardDeselected]}>
                <TouchableOpacity onPress={() => toggleItem(idx)} style={s.checkArea}>
                  <Ionicons
                    name={item.selected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={item.selected ? colors.accent.gold : colors.text.muted}
                  />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={s.itemNameInput}
                    value={item.name}
                    onChangeText={(text) => updateItemName(idx, text)}
                    placeholderTextColor={colors.text.muted}
                  />
                  <View style={s.itemMeta}>
                    <View style={[s.categoryBadge, item.category === 'drink' && s.categoryDrink]}>
                      <Text style={[s.categoryText, item.category === 'drink' && s.categoryTextDrink]}>
                        {item.category}
                      </Text>
                    </View>
                    {item.price && (
                      <Text style={s.priceText}>${item.price.toFixed(2)}</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity onPress={() => removeItem(idx)} style={s.removeBtn}>
                  <Ionicons name="close-circle" size={18} color={colors.text.muted} />
                </TouchableOpacity>
              </View>
            ))}

            {/* Save Button */}
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.7 }]}
              onPress={saveItems}
              disabled={saving || selectedCount === 0}
            >
              {saving ? (
                <ActivityIndicator color={colors.bg.primary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={colors.bg.primary} />
                  <Text style={s.saveBtnText}>Save {selectedCount} Items</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 40 },

  uploadCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed',
    marginTop: spacing.xl,
  },
  uploadTitle: {
    color: colors.text.primary,
    fontSize: fonts.sizes.lg,
    fontWeight: '700',
  },
  uploadSubtitle: {
    color: colors.text.muted,
    fontSize: fonts.sizes.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent.gold,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.md,
  },
  uploadBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  uploadBtnText: {
    color: colors.bg.primary,
    fontWeight: '700',
    fontSize: fonts.sizes.sm,
  },

  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  summaryText: {
    color: colors.text.primary,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
  },

  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.card,
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingLeft: spacing.sm,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  itemCardDeselected: {
    opacity: 0.5,
  },
  checkArea: {
    padding: 4,
    marginRight: 8,
  },
  itemNameInput: {
    color: colors.text.primary,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
    padding: 0,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  categoryBadge: {
    backgroundColor: colors.accent.green + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryDrink: {
    backgroundColor: colors.accent.blue + '20',
  },
  categoryText: {
    color: colors.accent.green,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  categoryTextDrink: {
    color: colors.accent.blue,
  },
  priceText: {
    color: colors.text.muted,
    fontSize: fonts.sizes.xs,
  },
  removeBtn: {
    padding: 4,
  },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent.gold,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  saveBtnText: {
    color: colors.bg.primary,
    fontWeight: '700',
    fontSize: fonts.sizes.md,
  },
});
