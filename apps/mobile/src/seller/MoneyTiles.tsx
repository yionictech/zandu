import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { formatXaf } from '../format';
import { t } from '../i18n/fr';
import { colors, font, radius, space } from '../theme';

/** Encart « Mon argent » : à recevoir et en séquestre, d'un coup d'œil. */
export function MoneyTiles({ available, inEscrow }: { available: number; inEscrow: number }) {
  return (
    <View style={styles.tiles}>
      <View style={[styles.tile, styles.tileTrust]}>
        <Text style={styles.tileLabel}>{t.seller.available}</Text>
        <Text style={[styles.tileAmount, { color: colors.trust }]} testID="money-available">
          {formatXaf(available)}
        </Text>
      </View>
      <View style={[styles.tile, styles.tileWaiting]}>
        <Text style={styles.tileLabel}>{t.seller.inEscrow}</Text>
        <Text style={[styles.tileAmount, { color: colors.waiting }]} testID="money-escrow">
          {formatXaf(inEscrow)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  tileTrust: { backgroundColor: colors.trustSoft },
  tileWaiting: { backgroundColor: colors.waitingSoft },
  tileLabel: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  tileAmount: { fontSize: font.title, fontWeight: '900' },
});
