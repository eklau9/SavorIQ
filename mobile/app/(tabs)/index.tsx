import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import { DeepAnalytics } from '@/lib/api';
import NoRestaurantSelected from '@/components/NoRestaurantSelected';

// Helper to render text with ++Item++ (green) and --Item-- (red) highlights
const renderFormattedText = (text: string) => {
  const parts = text.split(/(\+\+.*?\+\+|--.*?--)/g);
  return (
    <Text>
      {parts.map((part, i) => {
        if (part.startsWith('++') && part.endsWith('++')) {
          return (
            <Text key={i} style={{ color: colors.sentiment.positive, fontWeight: '700' }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('--') && part.endsWith('--')) {
          return (
            <Text key={i} style={{ color: colors.sentiment.negative, fontWeight: '700' }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
};

export default function DashboardScreen() {
  const router = useRouter();
  const { activeName, activeId } = useRestaurant();
  const { dashboardData: data, loading, refreshAll } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const handleResetKey = async () => {
    await AsyncStorage.removeItem('accessKey');
    alert('Access key cleared. Please reload the app or navigate to another tab.');
    // Ideally we'd use a context to trigger the layout gate, but this is a quick fix
    setError('Access key cleared. Please reload.');
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.accent.gold} />
      </View>
    );
  }

  if (error) {
    const isAuthError = error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('401');
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle" size={48} color={isAuthError ? colors.accent.gold : colors.accent.red} style={{ marginBottom: spacing.md }} />
        <Text style={[s.itemName, { textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: 20 }]}>{error}</Text>
        <View style={{ gap: spacing.sm }}>
          <TouchableOpacity style={s.retryBtn} onPress={() => refreshAll()}>
            <Text style={s.retryBtnText}>Retry Loading</Text>
          </TouchableOpacity>
          {isAuthError && (
            <TouchableOpacity
              style={[s.retryBtn, { borderStyle: 'dashed', backgroundColor: 'transparent' }]}
              onPress={handleResetKey}
            >
              <Text style={s.retryBtnText}>Reset Access Key</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent.gold}
        />
      }
    >
      {!activeId ? (
        <NoRestaurantSelected />
      ) : !data ? (
        <View style={[s.center, { marginTop: 100 }]}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      ) : (
        <>
          {/* Header Action */}
          <View style={s.headerRow}>
            <View>
              <Text style={s.welcomeText}>Intelligence Hub</Text>
              <Text style={s.activeLocText}>{activeName}</Text>
            </View>
          </View>
          {/* KPI Row */}
          <View style={s.kpiRow}>
            <KPICard
              label="Guests"
              value={data.overview.total_guests}
              icon="people"
              onPress={() => router.push('/guests')}
            />
            <KPICard
              label="Reviews"
              value={data.overview.total_reviews}
              icon="chatbubbles"
              onPress={() => router.push('/reviews')}
            />
            <KPICard
              label="Avg Rating"
              value={data.overview.avg_rating.toFixed(1)}
              icon="star"
              accent={colors.accent.gold}
              onPress={() => router.push('/rating-breakdown')}
            />
          </View>

          {/* AI Briefing */}
          {data.briefing && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="sparkles" size={18} color={colors.accent.gold} />
                <Text style={s.cardTitle}>Manager Briefing</Text>
              </View>
              <Text style={s.briefingSummary}>{renderFormattedText(data.briefing.summary)}</Text>
              {data.briefing.insights.map((insight, idx) => (
                <View key={idx} style={s.insightRow}>
                  <View style={[
                    s.insightBadge,
                    {
                      backgroundColor: insight.type === 'win' ? colors.accent.green + '20' :
                        insight.type === 'risk' ? colors.accent.red + '20' : colors.accent.blue + '20'
                    },
                  ]}>
                    <Ionicons
                      name={insight.type === 'win' ? 'trophy' : insight.type === 'risk' ? 'warning' : 'bulb'}
                      size={14}
                      color={insight.type === 'win' ? colors.accent.green :
                        insight.type === 'risk' ? colors.accent.red : colors.accent.blue}
                    />
                  </View>
                  <View style={s.insightContent}>
                    <Text style={s.insightTitle}>{insight.title}</Text>
                    <Text style={s.insightDesc}>{renderFormattedText(insight.description)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Top Performing Items */}
          {data.top_performers.length > 0 && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="trending-up" size={18} color={colors.sentiment.positive} />
                <Text style={s.cardTitle}>Top Performing Items</Text>
              </View>
              {data.top_performers.map((item, idx) => (
                <ItemRow key={idx} item={item} type="success" onPress={() => router.push(`/reviews?search=${encodeURIComponent(item.item_name)}`)} />
              ))}
            </View>
          )}

          {/* At-Risk Items */}
          {data.risks.length > 0 && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="trending-down" size={18} color={colors.accent.red} />
                <Text style={s.cardTitle}>At-Risk Items</Text>
              </View>
              {data.risks.map((item, idx) => (
                <ItemRow key={idx} item={item} type="danger" onPress={() => router.push(`/reviews?search=${encodeURIComponent(item.item_name)}`)} />
              ))}
            </View>
          )}

          {/* Customer Mentions — items not on the menu */}
          {data.unmatched_mentions && data.unmatched_mentions.length > 0 && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent.blue} />
                <Text style={s.cardTitle}>Customer Mentions (Not on Menu)</Text>
              </View>
              {data.unmatched_mentions.map((mention, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={s.itemRow}
                  onPress={() => router.push(`/reviews?search=${encodeURIComponent(mention.term)}`)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName}>{mention.term}</Text>
                  </View>
                  <View style={s.itemStats}>
                    <Text style={s.itemMentions}>{mention.mention_count}</Text>
                    <Text style={s.itemMentionLabel}>mentions</Text>
                  </View>
                  <View style={[s.sentimentBadge, {
                    backgroundColor: colors.accent.blue + '20',
                  }]}>
                    <Text style={[s.sentimentText, {
                      color: colors.accent.blue,
                    }]}>
                      Unmatched
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function KPICard({ label, value, icon, accent, onPress }: {
  label: string; value: string | number; icon: string; accent?: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={s.kpiCard}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <Ionicons name={icon as any} size={16} color={accent || colors.text.secondary} />
      <Text style={[s.kpiValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ItemRow({ item, type, onPress }: { item: any; type: 'success' | 'danger'; onPress: () => void }) {
  const isDanger = type === 'danger';
  return (
    <TouchableOpacity style={s.itemRow} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[s.itemName, { color: isDanger ? colors.accent.red : colors.sentiment.positive }]}>
          {item.item_name}
        </Text>
        <Text style={s.itemCat}>{item.category}</Text>
      </View>
      <View style={s.itemStats}>
        <Text style={s.itemMentions}>{item.review_count}</Text>
        <Text style={s.itemMentionLabel}>mentions</Text>
      </View>
      <View style={[s.sentimentBadge, {
        backgroundColor: isDanger ? colors.accent.red + '20' : colors.sentiment.positive + '20',
      }]}>
        <Text style={[s.sentimentText, {
          color: isDanger ? colors.accent.red : colors.sentiment.positive,
        }]}>
          {isDanger ? 'Criticized' : 'Praised'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.md, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg.primary },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  welcomeText: { color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  activeLocText: { color: colors.text.primary, fontSize: fonts.sizes.xl, fontWeight: '800', marginTop: 2 },
  syncBtn: {
    display: 'none',
  },
  syncBtnText: { color: colors.accent.gold, fontSize: fonts.sizes.xs, fontWeight: '700' },

  locationBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: colors.bg.card, borderRadius: radius.full,
    alignSelf: 'flex-start', marginBottom: spacing.md,
  },
  locationText: { color: colors.text.secondary, fontSize: fonts.sizes.sm },

  kpiRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  kpiCard: {
    flex: 1, backgroundColor: colors.bg.card, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  kpiValue: { color: colors.text.primary, fontSize: fonts.sizes.xl, fontWeight: '700' },
  kpiLabel: { color: colors.text.muted, fontSize: fonts.sizes.xs, textTransform: 'uppercase' },

  card: {
    backgroundColor: colors.bg.card, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  cardTitle: { color: colors.text.primary, fontSize: fonts.sizes.lg, fontWeight: '700' },

  briefingSummary: {
    color: colors.text.secondary, fontSize: fonts.sizes.md,
    lineHeight: 22, marginBottom: spacing.md,
  },

  insightRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  insightBadge: {
    width: 32, height: 32, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center',
  },
  insightContent: { flex: 1 },
  insightTitle: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
  insightDesc: { color: colors.text.secondary, fontSize: fonts.sizes.sm, lineHeight: 18, marginTop: 2 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  itemName: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600' },
  itemCat: { color: colors.text.muted, fontSize: fonts.sizes.xs, textTransform: 'uppercase', marginTop: 2 },
  itemStats: { alignItems: 'center' },
  itemMentions: { color: colors.text.primary, fontSize: fonts.sizes.lg, fontWeight: '700' },
  itemMentionLabel: { color: colors.text.muted, fontSize: fonts.sizes.xs },

  sentimentBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm,
  },
  sentimentText: { fontSize: fonts.sizes.xs, fontWeight: '600' },
  mentionSubtitle: {
    color: colors.text.muted, fontSize: fonts.sizes.sm,
    marginBottom: spacing.sm, marginTop: -spacing.xs,
  },
  retryBtn: {
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  retryBtnText: { color: colors.text.primary, fontWeight: '600' },
});
