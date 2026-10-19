import {
  Text as NativeText,
  TextInput as NativeTextInput,
  Platform,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { colors, fonts } from '../theme';

/**
 * La graisse demandée choisit la police : 800 et plus, la linéale large des titres et des
 * montants ; 600-700, DM Sans gras ; 500, moyen ; sinon normal. Une police donnée explicitement
 * (`fontFamily`) est respectée.
 */
function family(style: TextStyle): string {
  if (style.fontFamily) return style.fontFamily;
  const weight = Number(style.fontWeight === 'bold' ? 700 : (style.fontWeight ?? 400));
  if (weight >= 900) return fonts.displayHeavy;
  if (weight >= 800) return fonts.display;
  if (weight >= 600) return fonts.bold;
  if (weight >= 500) return fonts.medium;
  return fonts.regular;
}

/** Texte de l'application : couleur et police du thème sombre par défaut. */
export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  return (
    <NativeText
      {...props}
      style={[styles.base, style, { fontFamily: family(flat), fontWeight: 'normal' }]}
    />
  );
}

/** Champ de saisie : mêmes polices, texte clair, indication discrète. */
export function TextInput({ style, ...props }: TextInputProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  return (
    <NativeTextInput
      placeholderTextColor={colors.faint}
      selectionColor={colors.brand}
      {...props}
      style={[styles.base, styles.input, style, { fontFamily: family(flat), fontWeight: 'normal' }]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text },
  // Version web : pas de contour du navigateur, le composant dessine le sien.
  input: Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {},
});
