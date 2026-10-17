import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet } from 'react-native';
import { api, errorMessage, unwrap } from '../../src/api';
import { t } from '../../src/i18n/fr';
import { MissionCard } from '../../src/rider/MissionCard';
import { space } from '../../src/theme';
import { useRefetchOnFocus } from '../../src/useRefetchOnFocus';
import { Banner } from '../../src/ui/Banner';
import { Empty, Failure, Loading } from '../../src/ui/Layout';
import { RequireRole } from '../../src/ui/RequireRole';

function Missions() {
  const missions = useQuery({
    queryKey: ['rider', 'missions'],
    queryFn: async () => unwrap(await api.GET('/v1/rider/deliveries')).items,
    refetchInterval: 20_000,
  });
  useRefetchOnFocus(missions.refetch);

  if (missions.isPending) return <Loading />;
  if (missions.isError)
    return (
      <Failure message={errorMessage(missions.error)} onRetry={() => void missions.refetch()} />
    );
  return (
    <FlatList
      data={missions.data}
      keyExtractor={(m) => m.orderId}
      contentContainerStyle={styles.list}
      refreshing={missions.isRefetching}
      onRefresh={() => void missions.refetch()}
      ListHeaderComponent={<Banner message={`🛡 ${t.rider.prepaid}`} tone="trust" />}
      ListEmptyComponent={<Empty message={t.rider.empty} />}
      renderItem={({ item }) => <MissionCard mission={item} />}
    />
  );
}

/** Missions du livreur partenaire, dans l'ordre d'assignation. */
export default function RiderHome() {
  return (
    <RequireRole role="rider">
      <Missions />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
});
