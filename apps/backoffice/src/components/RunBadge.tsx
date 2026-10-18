import type { ReconciliationRun } from '@zandu/api-client';
import { RUN_STATUS } from '@/lib/labels';
import { Badge } from './ui';

/** « Équilibré », ou « Écarts traités » quand des écarts ont été trouvés puis clos. */
export function RunBadge({ run }: { run: ReconciliationRun }) {
  const [label, tone] = RUN_STATUS[run.status] ?? [run.status, 'neutral'];
  const handled = run.status === 'balanced' && (run.summary.discrepancies?.found ?? 0) > 0;
  return <Badge tone={handled ? 'waiting' : tone}>{handled ? 'Écarts traités' : label}</Badge>;
}
