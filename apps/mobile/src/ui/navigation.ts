import { colors, fonts } from '../theme';

/** En-têtes sombres : titre en linéale large, sans ombre, comme les maquettes. */
export const darkHeader = {
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
} as const;
