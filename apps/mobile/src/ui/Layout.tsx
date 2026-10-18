import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../i18n/fr';
import { useOnline } from '../network';
import { colors, font, space } from '../theme';
import { Button } from './Button';

/** Écran défilant avec une barre d'action fixe en bas (zone du pouce). */
export function Screen({
  children,
  footer,
  style,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  footer?: ReactNode;
  style?: ViewStyle;
  /** Tirer pour actualiser. */
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={[styles.content, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              colors={[colors.brand]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Chargement en cours ; sans réseau, un chargement qui attend n'aboutira pas avant son retour :
 * l'écran le dit (la page n'a jamais été enregistrée sur le téléphone).
 */
export function Loading() {
  const online = useOnline();
  if (!online) {
    return (
      <View style={styles.center} testID="offline-unsaved">
        <Text style={styles.emptyText}>{t.offline.unsaved}</Text>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export function Empty({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyText}>{message}</Text>
      {action && onAction ? <Button label={action} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

export function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Empty message={message} action={t.common.retry} onAction={onRetry} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.md, gap: space.md, paddingBottom: space.xl },
  footer: {
    padding: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: space.sm,
  },
  section: { backgroundColor: colors.surface, borderRadius: 12, padding: space.md, gap: space.sm },
  sectionTitle: { fontSize: font.title, fontWeight: '800', color: colors.text },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    gap: space.md,
    minHeight: 240,
  },
  emptyText: { fontSize: font.body, color: colors.muted, textAlign: 'center' },
});
