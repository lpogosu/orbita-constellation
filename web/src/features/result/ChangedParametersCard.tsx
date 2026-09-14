import { Wrench } from 'lucide-react';

import type { Variant } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { DASH } from '@/lib/run-format';

const LEFT = 37;
const TOP = 570;

/**
 * Card / Changed Parameters (50:643). В макете здесь состав группировки, но экран
 * называет блок «Изменённые параметры», и источник у него один — `diff_from_parent`
 * варианта: именно он отвечает на вопрос «чем этот расчёт отличается от предыдущего».
 */
export function ChangedParametersCard({
  variant,
  error,
  onRetry,
}: {
  variant: Variant | null;
  error: string | null;
  onRetry: () => void;
}) {
  const stacked = useStacked();
  const changes = variant?.diff_from_parent ?? [];

  const heading = stacked ? (
    <div className="flex items-center gap-[12px]">
      <Wrench aria-hidden="true" className="size-[24px] shrink-0 text-accent-blue" />
      <h2 className="text-title-m font-semibold text-ink-primary">Изменённые параметры</h2>
    </div>
  ) : (
    <>
      <Wrench aria-hidden="true" className="absolute left-[30px] top-[29px] size-[30px] text-accent-blue" />
      <h2 className="absolute left-[74px] top-[26px] text-title-l font-semibold text-ink-primary">
        Изменённые параметры
      </h2>
    </>
  );

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked
          ? 'flex h-full flex-col gap-[12px] p-[20px]'
          : 'absolute left-[37px] top-[570px] h-[323px] w-[483px]'
      }
    >
      {heading}

      <div className={stacked ? 'min-h-[200px] flex-1' : 'absolute left-[30px] top-[77px] h-[216px] w-[423px]'}>
        {error !== null && (
          <ErrorBlock title="Вариант не загрузился" message={error} onRetry={onRetry} />
        )}

        {error === null && variant === null && (
          <LoadingBlock label="Загружаем параметры варианта">
            <ul className="space-y-[8px]">
              {[0, 1, 2, 3].map((index) => (
                <li key={index}>
                  <Skeleton className={cx('h-[44px] rounded-sm', stacked ? 'w-full' : 'w-[420px]')} />
                </li>
              ))}
            </ul>
          </LoadingBlock>
        )}

        {error === null && variant !== null && changes.length === 0 && (
          <EmptyState
            icon={<Wrench aria-hidden="true" className="size-[22px]" />}
            title="Базовый вариант"
            hint="Параметры сценария не менялись: этот вариант — исходный файл проекта, и сравнивать его пока не с чем."
          />
        )}

        {error === null && variant !== null && changes.length > 0 && (
          <ul className={stacked ? 'w-full' : 'scroll-area h-full w-[429px] pr-[6px]'}>
            {changes.map((change) => (
              <li
                key={change.path}
                className={cx(
                  'flex h-[44px] items-center border-b border-line-divider last:border-b-0',
                  stacked ? 'gap-[10px]' : 'gap-[16px]',
                )}
              >
                <span
                  className={cx('min-w-0 flex-1 truncate text-ink-secondary', stacked ? 'text-small' : 'text-[16px]')}
                  title={change.path}
                >
                  {change.path}
                </span>
                <span className="shrink-0 text-[15px] text-ink-muted" data-numeric>
                  {String(change.from ?? DASH)}
                </span>
                <span aria-hidden="true" className="shrink-0 text-[15px] text-ink-muted">
                  →
                </span>
                <span className="shrink-0 text-[18px] font-bold text-ink-primary" data-numeric>
                  {String(change.to ?? DASH)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
