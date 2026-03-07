import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fonts } from '@/lib/theme';

export default function NoRestaurantSelected() {
    return (
        <View style={s.center}>
            <Ionicons name="restaurant-outline" size={48} color={colors.text.muted} />
            <Text style={s.title}>No Restaurant Selected</Text>
            <Text style={s.desc}>
                Please select a location in the 'More' tab to see analytics.
            </Text>
        </View>
    );
}

const s = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        backgroundColor: colors.bg.primary,
        paddingTop: 100,
    },
    title: {
        color: colors.text.primary,
        fontSize: fonts.sizes.lg,
        fontWeight: '700',
        marginTop: spacing.md,
    },
    desc: {
        color: colors.text.muted,
        textAlign: 'center',
        marginTop: 8,
        fontSize: fonts.sizes.sm,
        lineHeight: 20,
    },
});
