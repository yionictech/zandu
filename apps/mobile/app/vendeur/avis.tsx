import type { SellerReview } from '@zandu/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { formatDate } from '../../src/format';
import { t } from '../../src/i18n/fr';
import { sellerKeys, useSellerReviews } from '../../src/seller/queries';
import { colors, font, radius, space } from '../../src/theme';
import { ErrorText, Field } from '../../src/ui/Form';
import { Card } from '../../src/ui/kit';
import { Empty, Failure, Loading, Screen } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';
import { Text } from '../../src/ui/Text';

function ReviewCard({ review }: { review: SellerReview }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.reply ?? '');
  const reply = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/seller/reviews/{id}/reply', {
          params: { path: { id: review.id } },
          body: { text: text.trim() },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: sellerKeys.reviews });
    },
  });
  return (
    <Card testID={`review-${review.authorName}`}>
      <View style={styles.row}>
        <Text style={styles.author}>{review.authorName}</Text>
        <Text style={styles.small}>{formatDate(review.createdAt)}</Text>
      </View>
      <View style={styles.stars} accessibilityLabel={`${review.rating} étoiles`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={14}
            color={n <= review.rating ? colors.brand : colors.faint}
            fill={n <= review.rating ? colors.brand : 'transparent'}
          />
        ))}
        <Text style={styles.small}> · {review.productTitle}</Text>
      </View>
      {review.comment ? <Text style={styles.body}>{review.comment}</Text> : null}
      {review.tags.length ? (
        <View style={styles.tags}>
          {review.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{t.reviewTags[tag]}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {open ? (
        <>
          <Field
            label={t.vendor.yourReply}
            value={text}
            onChangeText={setText}
            placeholder={t.vendor.replyPlaceholder}
            multiline
            maxLength={1000}
          />
          <ErrorText message={reply.error ? errorMessage(reply.error) : null} />
          <Pressable
            style={[styles.pill, styles.pillBrand]}
            onPress={() => reply.mutate()}
            disabled={text.trim().length < 2 || reply.isPending}
            accessibilityRole="button"
          >
            <Text style={styles.pillBrandText}>{t.vendor.send}</Text>
          </Pressable>
        </>
      ) : review.reply ? (
        <Pressable style={styles.reply} onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={styles.replyText}>
            <Text style={styles.replyLabel}>{t.vendor.yourReply} · </Text>
            {review.reply}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          style={styles.pill}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          testID={`review-reply-${review.authorName}`}
        >
          <Text style={styles.pillText}>{t.vendor.reply}</Text>
        </Pressable>
      )}
    </Card>
  );
}

function Reviews() {
  const reviews = useSellerReviews();
  if (reviews.isPending) return <Loading />;
  if (reviews.isError)
    return <Failure message={errorMessage(reviews.error)} onRetry={() => void reviews.refetch()} />;
  const r = reviews.data;
  const max = Math.max(1, ...Object.values(r.distribution));
  return (
    <Screen refreshing={reviews.isRefetching} onRefresh={() => void reviews.refetch()}>
      <Card style={styles.summary}>
        <View style={styles.average}>
          <Text style={styles.big}>{r.average ? r.average.toFixed(1).replace('.', ',') : '—'}</Text>
          <Text style={styles.small}>{t.vendor.reviewsCount(r.count)}</Text>
        </View>
        <View style={styles.bars}>
          {(['5', '4', '3', '2', '1'] as const).map((n) => (
            <View key={n} style={styles.barRow}>
              <Text style={styles.small}>{n}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${(r.distribution[n] / max) * 100}%` }]} />
              </View>
            </View>
          ))}
        </View>
      </Card>
      {r.items.length === 0 ? <Empty message={t.vendor.noReviewsYet} /> : null}
      {r.items.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </Screen>
  );
}

/** Avis clients (maquette) : note moyenne, répartition, réponse publique sous chaque avis. */
export default function ReviewsScreen() {
  return (
    <RequireRole role="seller">
      <Reviews />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  average: { alignItems: 'center', gap: 2 },
  big: { fontSize: 40, fontWeight: '800', color: colors.text },
  bars: { flex: 1, gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { color: colors.text, fontWeight: '800', fontSize: font.body },
  small: { color: colors.muted, fontSize: 12 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  body: { color: colors.text, fontSize: font.body, lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  pillText: { color: colors.text, fontWeight: '700', fontSize: font.small },
  pillBrand: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillBrandText: { color: colors.onBrand, fontWeight: '800', fontSize: font.small },
  reply: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: space.sm + 2 },
  replyText: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  replyLabel: { color: colors.brand, fontWeight: '700' },
});
