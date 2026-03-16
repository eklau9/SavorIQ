import React, { useState, useCallback, useEffect } from 'react';
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
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '@/lib/theme';
import { useRestaurant } from '@/lib/RestaurantContext';
import { useData } from '@/lib/DataContext';
import { DeepAnalytics } from '@/lib/api';
import NoRestaurantSelected from '@/components/NoRestaurantSelected';
import { StartupLoadingScreen } from '@/components/StartupLoadingScreen';

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
  const { 
    dashboardData: data, 
    loading, 
    progress, 
    loadingStep, 
    estimatedSecondsRemaining, 
    refreshAll,
    error // Add error here
  } = useData();
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<number | null>(90); // Default to 90 days

  // Trigger refresh when timeRange changes
  useEffect(() => {
    if (activeId) {
      refreshAll(timeRange);
    }
  }, [timeRange, activeId, refreshAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const handleResetKey = async () => {
    await AsyncStorage.removeItem('accessKey');
    alert('Access key cleared. Please reload the app.');
  };

  if (loading && !data && activeId) {
    return (
      <StartupLoadingScreen 
        progress={progress} 
        loadingStep={loadingStep} 
        estimatedSecondsRemaining={estimatedSecondsRemaining} 
      />
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
      ) : (
        <>
          <Stack.Screen options={{ headerShown: false }} />
          
          {/* Header Action */}
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                  <Text style={[s.welcomeText, { color: colors.accent.gold }]}>
                    SavorIQ
                  </Text>
                </View>
                <Text style={[s.welcomeText, { textTransform: 'none', fontWeight: '500', opacity: 0.7 }]}>
                  {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <Text style={[s.activeLocText, { fontSize: 32, lineHeight: 38, letterSpacing: -0.5, fontWeight: '800' }]}>
                {activeName}
              </Text>
              
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
                {/* Productivity Alert Badge */}
                {data?.top_performers?.some(i => i.is_suggested) ? (
                  <TouchableOpacity 
                    style={s.integrityBadge}
                    onPress={() => alert("Self-Healing Active: We've automatically discovered these items from your reviews because your menu isn't fully configured yet.")}
                  >
                    <Ionicons name="shield-checkmark" size={12} color={colors.accent.gold} />
                    <Text style={s.integrityText}>AI Integrity Mode</Text>
                  </TouchableOpacity>
                ) : <View />}

                {/* Time Filter Chips */}
                <View style={s.filterRow}>
                   {[
                    { label: '30D', val: 30 },
                    { label: '90D', val: 90 },
                    { label: '6MO', val: 180 },
                    { label: '1Y', val: 365 },
                    { label: 'ALL', val: null }
                  ].map((chip) => (
                    <TouchableOpacity
                      key={chip.label}
                      onPress={() => setTimeRange(chip.val)}
                      style={[
                        s.filterChip,
                        timeRange === chip.val && s.filterChipActive
                      ]}
                    >
                      <Text style={[
                        s.filterChipText,
                        timeRange === chip.val && s.filterChipTextActive
                      ]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
          
          {/* KPI Row */}
          <View style={s.kpiRow}>
            <KPICard
              label="Guests"
              value={data?.overview?.total_guests ?? '...'}
              icon="people"
              onPress={() => router.push('/guests')}
            />
            <KPICard
              label="Reviews"
              value={data?.overview?.total_reviews ?? '...'}
              icon="chatbubbles"
              onPress={() => router.push('/reviews')}
            />
            <KPICard
              label="Avg Rating"
              value={data?.overview?.avg_rating !== undefined ? data.overview.avg_rating.toFixed(1) : '...'}
              icon="star"
              accent={colors.accent.gold}
              onPress={() => router.push('/rating-breakdown')}
            />
          </View>

          {/* AI Briefing */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Ionicons name="sparkles" size={18} color={colors.accent.gold} />
              <Text style={s.cardTitle}>Manager Briefing</Text>
            </View>
            {!data?.briefing ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator color={colors.accent.gold} />
                <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 8 }}>Generating AI Briefing...</Text>
              </View>
            ) : (
              <>
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
              </>
            )}
          </View>

          {/* Top Performing Items */}
          {(!data || data.top_performers.length > 0) && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="trending-up" size={18} color={colors.sentiment.positive} />
                <Text style={s.cardTitle}>Top Performing Items</Text>
              </View>
              {!data ? (
                <ActivityIndicator color={colors.sentiment.positive} style={{ marginVertical: 10 }} />
              ) : (
                data.top_performers.map((item, idx) => (
                  <ItemRow key={idx} item={item} type="success" onPress={() => router.push(`/reviews?search=${encodeURIComponent(item.item_name)}`)} />
                ))
              )}
            </View>
          )}

          {/* At-Risk Items */}
          {(!data || data.risks.length > 0) && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="trending-down" size={18} color={colors.accent.red} />
                <Text style={s.cardTitle}>At-Risk Items</Text>
              </View>
              {!data ? (
                <ActivityIndicator color={colors.accent.red} style={{ marginVertical: 10 }} />
              ) : (
                data.risks.map((item, idx) => (
                  <ItemRow key={idx} item={item} type="danger" onPress={() => router.push(`/reviews?search=${encodeURIComponent(item.item_name)}`)} />
                ))
              )}
            </View>
          )}

          {/* Customer Mentions — items not on the menu */}
          {(!data || (data.unmatched_mentions && data.unmatched_mentions.length > 0)) && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent.blue} />
                <Text style={s.cardTitle}>Customer Mentions (Not on Menu)</Text>
              </View>
              {!data ? (
                <ActivityIndicator color={colors.accent.blue} style={{ marginVertical: 10 }} />
              ) : (
                data.unmatched_mentions.map((mention, idx) => (
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
                ))
              )}
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
        backgroundColor: item.is_suggested ? colors.accent.gold + '15' : (isDanger ? colors.accent.red + '20' : colors.sentiment.positive + '20'),
      }]}>
        <Text style={[s.sentimentText, {
          color: item.is_suggested ? colors.accent.gold : (isDanger ? colors.accent.red : colors.sentiment.positive),
        }]}>
          {item.is_suggested ? 'Suggested' : (isDanger ? 'Criticized' : 'Praised')}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.md, paddingTop: 0, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg.primary },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 32,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  welcomeText: { color: colors.text.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  activeLocText: { color: colors.text.primary, fontSize: 32, fontWeight: '800', marginTop: 2 },
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
  integrityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent.gold + '20',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent.gold + '40',
  },
  integrityText: {
    color: colors.accent.gold,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  retryBtnText: { color: colors.text.primary, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  filterChipActive: {
    backgroundColor: colors.accent.gold + '20',
    borderColor: colors.accent.gold,
  },
  filterChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text.muted,
  },
  filterChipTextActive: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
});
