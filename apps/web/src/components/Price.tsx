import { groupThousands } from '@/lib/format';

/** « 95 000 FCFA » : chiffres en linéale large, « FCFA » plus petit (maquettes). */
export function Price({
  value,
  size = 'md',
  was,
  testId,
}: {
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Ancien prix, barré. */
  was?: number | null;
  testId?: string;
}) {
  return (
    <span className={`amount amount-${size}`} data-testid={testId}>
      {groupThousands(value)}
      <small> FCFA</small>
      {was && was > value ? <s className="was">{groupThousands(was)} FCFA</s> : null}
    </span>
  );
}
