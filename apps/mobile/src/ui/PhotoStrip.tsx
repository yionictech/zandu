import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Button } from './Button';

export interface PhotoItem {
  key: string;
  uri: string;
  state: 'uploading' | 'ready' | 'failed';
}

/**
 * « La photo d'abord » : sans photo, l'écran commence par l'appareil photo ; ensuite, les
 * vignettes avec leur état d'envoi (l'envoi démarre pendant que le vendeur tape le reste).
 */
export function PhotoStrip({
  photos,
  max,
  busy,
  onAdd,
  onRemove,
  onRetry,
}: {
  photos: PhotoItem[];
  max: number;
  busy?: boolean;
  onAdd: (source: 'camera' | 'library') => void;
  onRemove: (key: string) => void;
  onRetry?: (key: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <View style={styles.empty}>
        <Button
          label={t.upload.camera}
          onPress={() => onAdd('camera')}
          loading={busy}
          testID="photo-camera"
        />
        <Button
          label={t.upload.library}
          variant="secondary"
          onPress={() => onAdd('library')}
          disabled={busy}
          testID="photo-library"
        />
        <Text style={styles.tip}>{t.upload.tip}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {photos.map((photo, index) => (
          <View key={photo.key} style={styles.thumbWrap}>
            <Pressable
              onPress={() => (photo.state === 'failed' ? onRetry?.(photo.key) : undefined)}
              accessibilityLabel={photo.state === 'failed' ? t.upload.failed : `Photo ${index + 1}`}
            >
              <Image source={{ uri: photo.uri }} style={styles.thumb} contentFit="cover" />
              {photo.state !== 'ready' ? (
                <View
                  style={[styles.overlay, photo.state === 'failed' && styles.overlayFailed]}
                  testID={`photo-${photo.state}`}
                >
                  {photo.state === 'uploading' ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.retry}>↻</Text>
                  )}
                </View>
              ) : null}
            </Pressable>
            <Pressable
              style={styles.remove}
              onPress={() => onRemove(photo.key)}
              accessibilityLabel={`${t.upload.remove} la photo ${index + 1}`}
              hitSlop={8}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}
        {photos.length < max ? (
          <Pressable
            style={[styles.thumb, styles.add]}
            onPress={() => onAdd('camera')}
            accessibilityLabel={t.upload.camera}
            disabled={busy}
            testID="photo-add"
          >
            {busy ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Camera color={colors.muted} size={26} strokeWidth={1.8} />
            )}
          </Pressable>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.count}>{t.upload.count(photos.length, max)}</Text>
        {photos.length < max ? (
          <Pressable onPress={() => onAdd('library')} disabled={busy} hitSlop={8}>
            <Text style={styles.link}>{t.upload.library}</Text>
          </Pressable>
        ) : null}
      </View>
      {photos.some((p) => p.state === 'failed') ? (
        <Text style={styles.failed}>{t.upload.failed}</Text>
      ) : null}
    </View>
  );
}

const THUMB = 88;

const styles = StyleSheet.create({
  empty: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.faint,
    backgroundColor: colors.brandSoft,
  },
  tip: { color: colors.muted, fontSize: font.small, textAlign: 'center', lineHeight: 19 },
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    backgroundColor: colors.placeholder,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    backgroundColor: 'rgba(11,14,21,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayFailed: { backgroundColor: 'rgba(247,120,88,0.75)' },
  retry: { color: colors.onBrand, fontSize: 28, fontWeight: '800' },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: colors.text, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.faint,
    backgroundColor: colors.brandSoft,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { color: colors.muted, fontSize: font.small },
  link: { color: colors.brand, fontSize: font.small, fontWeight: '700' },
  failed: { color: colors.danger, fontSize: font.small },
});
