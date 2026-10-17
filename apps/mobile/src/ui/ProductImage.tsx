import { Image } from 'expo-image';
import {
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme';

/** Photo produit ; à défaut, une vignette avec l'initiale (aucun octet téléchargé). */
export function ProductImage({
  uri,
  title,
  style,
}: {
  uri: string | null;
  title: string;
  style?: StyleProp<ImageStyle>;
}) {
  if (!uri) {
    return (
      <View style={[styles.placeholder, style as StyleProp<ViewStyle>]} accessibilityLabel={title}>
        <Text style={styles.initial}>{title.trim().charAt(0).toUpperCase()}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.image, style]}
      contentFit="cover"
      transition={150}
      accessibilityLabel={title}
    />
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.placeholder },
  placeholder: {
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 40, fontWeight: '800', color: colors.brand, opacity: 0.6 },
});
