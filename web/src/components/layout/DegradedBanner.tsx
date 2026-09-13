import { AlertCircle, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { HealthResponse } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';

interface DegradedBannerProps {
  readonly health: HealthResponse;
  readonly onRefresh: () => void;
}

/**
 * Полоса деградации (узел макета `91:795`, `Banner/Degraded`). Занимает 40 px, зарезервированные
 * под шапкой на всех экранах (`AppLayout`) — экраны не двигаются, когда баннер появляется или
 * пропадает. Показывается, только когда `GET /api/health` вернул `degraded_mode: true`
 * (`06_STORAGE.md` §7): часть хранилищ недоступна, но обязательный расчёт идёт локальными
 * адаптерами — это не авария, поэтому баннер не блокирует работу.
 */
export function DegradedBanner({ health, onRefresh }: DegradedBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const down = useMemo(
    () => Object.entries(health.services).filter(([, status]) => status === 'down').map(([name]) => name),
    [health.services],
  );

  // Закрытие относится к конкретному набору недоступных хранилищ: если состав изменился
  // (появилось новое down-хранилище), это уже другой инцидент — баннер обязан вернуться.
  const incidentKey = down.slice().sort().join(',');
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const stacked = useStacked();

  if (dismissedKey === incidentKey) {
    return null;
  }

  return (
    <div
      className={cx(
        'z-[5] flex bg-[rgba(255,160,92,0.14)]',
        // На полотне баннер — полоса под шапкой. В потоке это первый блок колонки: текст
        // переносится, а не обрезается, действия уходят на вторую строку.
        stacked
          ? 'relative flex-col gap-[8px] rounded-md px-[14px] py-[10px]'
          : 'absolute inset-x-0 top-[92px] h-[40px] items-center justify-between px-[44px]',
      )}
    >
      <div className={cx('flex min-w-0 gap-[10px]', stacked ? 'items-start' : 'items-center')}>
        <AlertCircle aria-hidden="true" className="size-[18px] shrink-0 text-status-warning" />
        <p className={cx('text-small font-medium text-ink-primary', !stacked && 'truncate')}>
          Часть хранилищ недоступна — обязательный расчёт идёт локальными адаптерами
          {down.length > 0 && expanded && `: ${down.join(', ')}`}
        </p>
        {down.length > 0 && (
          <button
            type="button"
            onClick={() => { setExpanded((value) => !value); }}
            className="shrink-0 text-small font-semibold text-accent-blue transition-colors duration-150 hover:brightness-110"
          >
            {expanded ? 'Свернуть' : 'Подробнее'}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-[16px]">
        <button
          type="button"
          onClick={onRefresh}
          className="text-small font-semibold text-status-warning transition-colors duration-150 hover:brightness-110"
        >
          Обновить
        </button>
        <button
          type="button"
          aria-label="Скрыть баннер"
          onClick={() => { setDismissedKey(incidentKey); }}
          className="text-ink-muted transition-colors duration-150 hover:text-ink-primary"
        >
          <X aria-hidden="true" className="size-[16px]" />
        </button>
      </div>

      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[rgba(255,160,92,0.45)]" />
    </div>
  );
}
