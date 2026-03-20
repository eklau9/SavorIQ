import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,

  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
  Animated,
  Alert,
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

// Helper to render text with colored item highlights
// sentimentType: 'win' = green, 'risk' = red, default = gold
const renderFormattedText = (text: string, sentimentType?: string) => {
  const parts = text.split(/(\+\+.*?\+\+|--.*?--|`[^`]+`)/g);
  
  // Green for positive/action, red for risk — no other colors
  const itemColor = sentimentType === 'risk' ? colors.sentiment.negative : colors.sentiment.positive;

  return (
    <Text>
      {parts.map((part, i) => {
        let inner = part;
        let isItem = false;

        // Strip all marker types
        if (inner.startsWith('`') && inner.endsWith('`')) {
          inner = inner.slice(1, -1);
          isItem = true;
        }
        if (inner.startsWith('++') && inner.endsWith('++')) {
          inner = inner.slice(2, -2);
          isItem = true;
        }
        if (inner.startsWith('--') && inner.endsWith('--')) {
          inner = inner.slice(2, -2);
          isItem = true;
        }

        // Clean any remaining stray markers
        inner = inner.replace(/^\+\+|\+\+$/g, '').replace(/^--|--$/g, '').replace(/^`|`$/g, '');

        if (isItem && inner.trim()) {
          return (
            <Text key={i} style={{ color: itemColor, fontWeight: '700' }}>
              {inner.trim()}
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
  const { activeName, activeId, loading: restaurantLoading } = useRestaurant();
  const { 
    dashboardData: data, 
    loading, 
    progress, 
    loadingStep, 
    estimatedSecondsRemaining, 
    refreshAll,
    error,
    timeRange,
    setTimeRange,
    skipLoading,
    briefingLoaded,
    cacheReady,
    historicalTrends,
  } = useData();

  const [showIntegrityModal, setShowIntegrityModal] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const intelReady = briefingLoaded && !!data;

  const handleSkip = useCallback(() => {
    setSkipped(true);
    skipLoading();
  }, [skipLoading]);

  // No need for showIntelBadge state - badge is always visible now

  // Switch dashboard data when timeRange changes (reads from in-memory cache, no API calls)
  useEffect(() => {
    if (activeId && cacheReady) {
      refreshAll(timeRange);
    }
  }, [timeRange, activeId, cacheReady]);



  const handleResetKey = async () => {
    await AsyncStorage.removeItem('accessKey');
    alert('Access key cleared. Please reload the app.');
  };

  // Show loading screen during initial data load AND during prefetch of all date ranges.
  // `loading` stays true until all 5 frames (1M, 3M, 6M, 1Y, All) are prefetched.
  const isInitialLoad = !error && (restaurantLoading || (activeId && (!data || loading)));
  if (isInitialLoad) {
    return (
      <StartupLoadingScreen 
        progress={progress} 
        loadingStep={loadingStep} 
        estimatedSecondsRemaining={estimatedSecondsRemaining}
        onSkip={!skipped ? handleSkip : undefined}
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
    <View style={{ flex: 1 }}>
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
    >
      {!activeId && !restaurantLoading ? (
        <NoRestaurantSelected />
      ) : (
        <>
          <Stack.Screen options={{ headerShown: false }} />
          

          {/* Header Action */}
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="sparkles-outline" size={14} color={colors.accent.gold} />
                  <Text style={[s.welcomeText, { color: colors.accent.gold }]}>
                    SavorIQ
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={[s.activeLocText, { fontSize: 32, lineHeight: 38, letterSpacing: -0.5, fontWeight: '800', flex: 1 }]}>
                  {activeName}
                </Text>
                <Text style={{ color: colors.text.secondary, fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginLeft: 8 }}>
                  {new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
                </Text>
              </View>
              
              <View style={{ marginTop: 8 }}>
                {/* Badge Row (left) + Time Selector (right) — single row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                  {data?.top_performers?.some(i => i.is_suggested) && (
                    <TouchableOpacity 
                      style={s.integrityBadge}
                      onPress={() => setShowIntegrityModal(true)}
                    >
                      <Ionicons name="shield-checkmark" size={12} color={colors.accent.gold} />
                      <Text style={s.integrityText}>AI Integrity Mode</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.intelBadge, !intelReady && s.intelBadgeLoading]}
                    onPress={() => {
                      if (!intelReady) {
                        Alert.alert(
                          'Loading Intelligence',
                          'Reviews and analytics are still being processed. This usually takes a few seconds.',
                          [{ text: 'OK' }]
                        );
                      }
                    }}
                    activeOpacity={intelReady ? 1 : 0.7}
                  >
                    <Ionicons
                      name={intelReady ? 'checkmark-circle' : 'ellipsis-horizontal-circle'}
                      size={12}
                      color={intelReady ? colors.sentiment.positive : colors.text.muted}
                    />
                    <Text style={[s.intelBadgeText, !intelReady && s.intelBadgeTextLoading]}>
                      {intelReady ? 'Intelligence Ready' : 'Syncing...'}
                    </Text>
                  </TouchableOpacity>

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
              <Text style={[s.cardTitle, { flex: 1 }]}>Manager Briefing</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {[
                  { label: '1M', val: 30 },
                  { label: '3M', val: 90 },
                  { label: '6M', val: 180 },
                  { label: '1Y', val: 365 },
                  { label: 'All', val: null }
                ].map((chip) => (
                  <TouchableOpacity
                    key={chip.label}
                    onPress={() => setTimeRange(chip.val)}
                    style={{ paddingVertical: 2 }}
                  >
                    <Text style={{
                      fontSize: 13,
                      fontWeight: timeRange === chip.val ? '700' : '500',
                      color: timeRange === chip.val ? colors.accent.gold : colors.text.muted,
                      letterSpacing: 0.3,
                    }}>
                      {chip.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {!data?.briefing ? (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator color={colors.accent.gold} />
                <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 8 }}>Generating AI Briefing...</Text>
              </View>
            ) : (
              <>
                <Text style={s.briefingSummary}>{renderFormattedText(data.briefing.summary)}</Text>
                {data.briefing.review_count_note && (
                  <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, marginBottom: spacing.sm, fontStyle: 'italic' }}>
                    {data.briefing.review_count_note}
                  </Text>
                )}
                {data.briefing.insights.map((insight, idx) => {
                  // Use review IDs if available (exact citation), fall back to keyword search
                  const hasReviewIds = insight.review_ids && insight.review_ids.length > 0;
                  const searchTerms = (insight.keywords && insight.keywords.length > 0)
                    ? insight.keywords.join('|')
                    : '';
                  const navParams = hasReviewIds
                    ? `ids=${encodeURIComponent(insight.review_ids.join(','))}${timeRange ? `&days=${timeRange}` : ''}`
                    : `${searchTerms ? `search=${encodeURIComponent(searchTerms)}&` : ''}${timeRange ? `days=${timeRange}` : ''}`;
                  return (
                  <TouchableOpacity
                    key={idx}
                    style={s.insightRow}
                    onPress={() => router.push(`/reviews?${navParams}` as any)}
                    activeOpacity={0.7}
                  >
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
                      <Text style={[s.insightTitle, { color: insight.type === 'risk' ? colors.sentiment.negative : colors.sentiment.positive }]}>{insight.title.replace(/\+\+|--|`/g, '')}</Text>
                      <Text style={s.insightDesc}>{renderFormattedText(insight.description, insight.type)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.text.muted} style={{ alignSelf: 'center' }} />
                  </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>

          {/* Historical Trends — visible on 1Y and ALL only */}
          {(timeRange === 365 || timeRange === null) && historicalTrends && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Ionicons name="analytics" size={18} color={colors.accent.blue} />
                <Text style={s.cardTitle}>Historical Trends</Text>
              </View>

              {/* Sentiment Shifts */}
              {historicalTrends.sentiment_shifts.length > 0 && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '600', marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1 }}>Sentiment Shift (6mo vs prior 6mo)</Text>
                  {historicalTrends.sentiment_shifts.map((s_item, idx) => {
                    const isUp = s_item.shift !== null && s_item.shift > 0;
                    const isDown = s_item.shift !== null && s_item.shift < 0;
                    const shiftColor = isUp ? colors.sentiment.positive : isDown ? colors.sentiment.negative : colors.text.muted;
                    const bucketIcon = s_item.bucket === 'food' ? 'restaurant' : s_item.bucket === 'drink' ? 'wine' : 'leaf';
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: idx < historicalTrends.sentiment_shifts.length - 1 ? 1 : 0, borderBottomColor: colors.border.subtle }}>
                        <Ionicons name={bucketIcon as any} size={16} color={shiftColor} style={{ marginRight: 10 }} />
                        <Text style={{ color: colors.text.primary, fontSize: fonts.sizes.sm, flex: 1, textTransform: 'capitalize' }}>{s_item.bucket}</Text>
                        <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, marginRight: 8 }}>{s_item.previous !== null ? s_item.previous.toFixed(2) : '—'}</Text>
                        <Ionicons name={isUp ? 'arrow-up' : isDown ? 'arrow-down' : 'remove'} size={12} color={shiftColor} />
                        <Text style={{ color: shiftColor, fontSize: fonts.sizes.sm, fontWeight: '700', marginLeft: 4, minWidth: 45, textAlign: 'right' }}>{s_item.current !== null ? s_item.current.toFixed(2) : '—'}</Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Quarterly Ratings */}
              {historicalTrends.quarterly_ratings.length > 0 && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '600', marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1 }}>Quarterly Ratings</Text>
                  {historicalTrends.quarterly_ratings.slice(-6).map((q, idx) => {
                    const ratingColor = q.avg_rating >= 4.0 ? colors.sentiment.positive : q.avg_rating >= 3.0 ? colors.accent.gold : colors.sentiment.negative;
                    const barWidth = Math.min(100, (q.avg_rating / 5) * 100);
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, width: 60 }}>{q.quarter}</Text>
                        <View style={{ flex: 1, height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, marginHorizontal: 8 }}>
                          <View style={{ width: `${barWidth}%`, height: 6, backgroundColor: ratingColor, borderRadius: 3 }} />
                        </View>
                        <Text style={{ color: ratingColor, fontSize: fonts.sizes.xs, fontWeight: '700', width: 30, textAlign: 'right' }}>{q.avg_rating.toFixed(1)}</Text>
                        <Text style={{ color: colors.text.muted, fontSize: 10, width: 40, textAlign: 'right' }}>({q.review_count})</Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Monthly Volume */}
              {historicalTrends.monthly_volume.length > 0 && (
                <View>
                  <Text style={{ color: colors.text.muted, fontSize: fonts.sizes.xs, fontWeight: '600', marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1 }}>Monthly Review Volume</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 2 }}>
                    {historicalTrends.monthly_volume.slice(-12).map((m, idx) => {
                      const maxCount = Math.max(...historicalTrends.monthly_volume.slice(-12).map(v => v.review_count));
                      const barHeight = maxCount > 0 ? (m.review_count / maxCount) * 50 : 0;
                      return (
                        <View key={idx} style={{ flex: 1, alignItems: 'center' }}>
                          <View style={{ width: '80%', height: barHeight, backgroundColor: colors.accent.blue + '60', borderRadius: 2, minHeight: 2 }} />
                          <Text style={{ color: colors.text.muted, fontSize: 7, marginTop: 2 }}>{m.month.slice(5)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

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

        </>
      )}
    </ScrollView>

    {/* AI Integrity Mode Overlay */}
    <Modal
      visible={showIntegrityModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowIntegrityModal(false)}
    >
      <Pressable style={s.modalBackdrop} onPress={() => setShowIntegrityModal(false)}>
        <Pressable style={s.modalSheet} onPress={e => e.stopPropagation()}>
          {/* Header */}
          <View style={s.modalHeader}>
            <View style={s.modalIconCircle}>
              <Ionicons name="shield-checkmark" size={20} color={colors.accent.gold} />
            </View>
            <Text style={s.modalTitle}>AI Integrity Mode</Text>
            <TouchableOpacity onPress={() => setShowIntegrityModal(false)} hitSlop={16}>
              <Ionicons name="close" size={22} color={colors.text.muted} />
            </TouchableOpacity>
          </View>

          {/* Explanation */}
          <Text style={s.modalDesc}>
            Your menu isn't fully configured yet. SavorIQ automatically discovered these items from guest reviews using AI — they're marked as{' '}
            <Text style={{ color: colors.accent.gold, fontWeight: '700' }}>Suggested</Text>.
          </Text>

          {/* Stats */}
          {(() => {
            const allItems = [...(data?.top_performers ?? []), ...(data?.risks ?? [])];
            const suggested = allItems.filter(i => i.is_suggested);
            const confirmed = allItems.filter(i => !i.is_suggested);
            return (
              <View style={s.modalStatsRow}>
                <View style={s.modalStat}>
                  <Text style={[s.modalStatNum, { color: colors.accent.gold }]}>{suggested.length}</Text>
                  <Text style={s.modalStatLabel}>AI Discovered</Text>
                </View>
                <View style={[s.modalStatDivider]} />
                <View style={s.modalStat}>
                  <Text style={[s.modalStatNum, { color: colors.sentiment.positive }]}>{confirmed.length}</Text>
                  <Text style={s.modalStatLabel}>Menu Verified</Text>
                </View>
              </View>
            );
          })()}

          {/* Item List */}
          <Text style={s.modalSectionTitle}>Auto-Discovered Items</Text>
          <ScrollView style={s.modalItemList} showsVerticalScrollIndicator={false}>
            {[...(data?.top_performers ?? []), ...(data?.risks ?? [])]
              .filter(i => i.is_suggested)
              .sort((a, b) => b.review_count - a.review_count)
              .slice(0, 10)
              .map((item, idx) => (
                <View key={idx} style={s.modalItemRow}>
                  <Ionicons name="sparkles" size={12} color={colors.accent.gold} />
                  <Text style={s.modalItemName}>{item.item_name}</Text>
                  <Text style={s.modalItemCount}>{item.review_count} mentions</Text>
                </View>
              ))}
          </ScrollView>

          {/* CTA */}
          <View style={s.modalCTA}>
            <Ionicons name="information-circle-outline" size={14} color={colors.text.muted} />
            <Text style={s.modalCTAText}>
              Configure your full menu in Settings to remove suggested items and get precise tracking.
            </Text>
          </View>

          <TouchableOpacity
            style={s.modalDismissBtn}
            onPress={() => setShowIntegrityModal(false)}
          >
            <Text style={s.modalDismissBtnText}>Got It</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
    </View>
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
    paddingHorizontal: 0,
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

  insightRow: {
    flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.bg.input, borderRadius: radius.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border.subtle,
  },
  insightBadge: {
    width: 32, height: 32, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center',
  },
  insightContent: { flex: 1 },
  insightTitle: { color: colors.text.primary, fontSize: fonts.sizes.md, fontWeight: '600', marginBottom: 4 },
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
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent.gold + '40',
  },
  integrityText: {
    color: colors.accent.gold,
    fontSize: fonts.sizes.sm,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  retryBtnText: { color: colors.text.primary, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  filterChipActive: {
    backgroundColor: colors.accent.gold + '20',
    borderColor: colors.accent.gold,
  },
  filterChipText: {
    fontSize: fonts.sizes.sm,
    fontWeight: '500' as const,
    color: colors.text.muted,
  },
  filterChipTextActive: {
    color: colors.accent.gold,
    fontWeight: '700',
  },

  // AI Integrity Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end' as const,
  },
  modalSheet: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: 32,
    maxHeight: '80%' as any,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modalIconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accent.gold + '15',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  modalTitle: {
    flex: 1, color: colors.text.primary,
    fontSize: fonts.sizes.lg, fontWeight: '700' as const,
  },
  modalDesc: {
    color: colors.text.secondary, fontSize: fonts.sizes.sm,
    lineHeight: 20, marginBottom: spacing.md,
  },
  modalStatsRow: {
    flexDirection: 'row' as const,
    backgroundColor: colors.bg.primary, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md,
  },
  modalStat: { flex: 1, alignItems: 'center' as const },
  modalStatDivider: { width: 1, backgroundColor: colors.border.subtle },
  modalStatNum: { fontSize: fonts.sizes.xl, fontWeight: '700' as const },
  modalStatLabel: { color: colors.text.muted, fontSize: fonts.sizes.xs, marginTop: 2 },
  modalSectionTitle: {
    color: colors.text.muted, fontSize: fonts.sizes.xs,
    fontWeight: '700' as const, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  modalItemList: { maxHeight: 200, marginBottom: spacing.md },
  modalItemRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    gap: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  modalItemName: {
    flex: 1, color: colors.text.primary,
    fontSize: fonts.sizes.sm, fontWeight: '500' as const,
  },
  modalItemCount: { color: colors.text.muted, fontSize: fonts.sizes.xs },
  modalCTA: {
    flexDirection: 'row' as const, gap: 6,
    alignItems: 'flex-start' as const,
    backgroundColor: colors.bg.primary, borderRadius: radius.sm,
    padding: spacing.sm, marginBottom: spacing.md,
  },
  modalCTAText: { flex: 1, color: colors.text.muted, fontSize: 11, lineHeight: 16 },
  modalDismissBtn: {
    backgroundColor: colors.accent.gold, borderRadius: radius.md,
    paddingVertical: 12, alignItems: 'center' as const,
  },
  modalDismissBtnText: {
    color: colors.bg.primary, fontSize: fonts.sizes.md, fontWeight: '700' as const,
  },
  intelBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.sentiment.positive + '15',
    marginTop: 8,
    alignSelf: 'flex-start' as const,
    borderWidth: 1,
    borderColor: colors.sentiment.positive + '30',
  },
  intelBadgeText: {
    color: colors.sentiment.positive,
    fontSize: fonts.sizes.sm,
    fontWeight: '600' as const,
  },
  intelBadgeLoading: {
    backgroundColor: colors.text.muted + '15',
    borderColor: colors.text.muted + '30',
  },
  intelBadgeTextLoading: {
    color: colors.text.muted,
  },
});
