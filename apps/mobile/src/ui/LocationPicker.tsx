import type { LatLng } from '@zandu/domain';
import * as Location from 'expo-location';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';
import { Button } from './Button';
import { LiveMap } from './LiveMap';
import { Text } from './Text';

export type PinnedLocation = LatLng & { accuracy?: number };

/**
 * « Votre porte sur la carte » (docs/ux/03 §16), facultatif : la position actuelle du téléphone,
 * que le client ajuste d'un toucher sur la carte. Le repère écrit reste obligatoire : c'est lui
 * que le livreur lit, la carte l'aide seulement à trouver la bonne rue.
 */
export function LocationPicker({
  value,
  onChange,
  title,
  hint,
  start,
  testPrefix = 'checkout-pin',
}: {
  value: PinnedLocation | null;
  onChange: (value: PinnedLocation | null) => void;
  /** Titre et texte d'aide (par défaut : « Votre porte sur la carte »). */
  title?: string;
  hint?: string;
  /** Point de départ proposé quand on choisit sur la carte (ex. l'arrivée près du départ). */
  start?: LatLng | null;
  testPrefix?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const locate = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setProblem(t.checkout.pinDenied);
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      onChange({
        lat: coords.latitude,
        lng: coords.longitude,
        ...(coords.accuracy != null ? { accuracy: coords.accuracy } : {}),
      });
    } catch {
      setProblem(t.checkout.pinFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <MapPin color={colors.danger} size={18} strokeWidth={1.8} />
        <Text style={styles.title}>{title ?? t.checkout.pinTitle}</Text>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={12} accessibilityRole="button">
            <Text style={styles.remove}>{t.checkout.pinRemove}</Text>
          </Pressable>
        ) : null}
      </View>
      {value ? (
        <>
          <LiveMap
            lat={value.lat}
            lng={value.lng}
            pin="home"
            zoom={17}
            height={200}
            // Ajusté à la main : la précision du GPS ne vaut plus.
            onPick={(point) => onChange(point)}
            label={title ?? t.checkout.pinTitle}
            testID={`${testPrefix}-map`}
          />
          <Text style={styles.hint}>{t.checkout.pinAdjust}</Text>
        </>
      ) : (
        <>
          <Text style={styles.hint}>{hint ?? t.checkout.pinHint}</Text>
          <Button
            label={t.checkout.pinUse}
            variant="secondary"
            onPress={() => void locate()}
            loading={busy}
            testID={testPrefix}
          />
          {start ? (
            <Button
              label={t.ride.pickOnMap}
              variant="ghost"
              onPress={() => onChange({ lat: start.lat + 0.004, lng: start.lng + 0.004 })}
              testID={`${testPrefix}-on-map`}
            />
          ) : null}
        </>
      )}
      {problem ? <Text style={styles.hint}>{problem}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, color: colors.text, fontWeight: '700', fontSize: font.body },
  remove: { color: colors.brand, fontWeight: '600', fontSize: font.small },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
});
