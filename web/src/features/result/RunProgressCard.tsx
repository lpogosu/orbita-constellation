import { AlertTriangle, RotateCw } from 'lucide-react';

import type { Run } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { runStatusLabel } from '@/lib/run-format';

const LEFT = 37;
const TOP = 249;

/** Стадии расчёта (`RunStage`) словами: пользователь видит, на чём стоит очередь. */
const STAGES: Record<Run['stage'], string> = {
  validate: 'проверяем сценарий',
  geometry: 'считаем геометрию орбит',
  contacts: 'ищем контакты и линии',
  routing: 'строим маршруты по отсчётам',
  analytics: 'собираем метрики и перерывы',
  persist: 'сохраняем результат',
  complete: 'готово',
};

interface RunProgressCardProps {
  run: Run;
  /** Перезапуск того же варианта с той же политикой после `failed`. */
  onRetry: () => void;
  retrying: boolean;
  retryError: string | null;
}

/**
 * Занимает место всех блоков результата, пока результата нет. Показывать пустые карточки
 * со скелетонами до конца расчёта нечестно: они обещают данные, которых ещё не считали.
 */
export function RunProgressCard({ run, onRetry, retrying, retryError }: RunProgressCardProps) {
  const stacked = useStacked();
  const failed = run.status === 'failed' || run.status === 'cancelled';
  const percent = Math.round(run.progress * 100);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={cx(
        'flex flex-col items-center justify-center text-center',
        stacked
          ? 'min-h-[360px] gap-[16px] px-[20px] py-[40px]'
          : 'absolute left-[37px] top-[249px] h-[806px] w-[1295px] gap-[20px] px-[80px]',
      )}
    >
      {failed ? (
        <>
          <AlertTriangle aria-hidden="true" className="size-[48px] text-status-danger" />
          <p className={cx('font-bold text-ink-primary', stacked ? 'text-title-l' : 'text-heading-m')}>
            {run.status === 'failed' ? 'Расчёт не удался' : 'Расчёт отменён'}
          </p>
          <p className={cx('max-w-[62ch] text-ink-secondary', stacked ? 'text-small' : 'text-body')}>
            {run.error?.message ??
              'Сервис не сообщил причину. Повторный запуск того же варианта безопасен: результат определяется сценарием и политикой.'}
          </p>
          {run.status === 'failed' && (
            <p className="text-small text-ink-muted">Остановился на стадии «{STAGES[run.stage]}»</p>
          )}
          {run.error?.path != null && (
            <p className="max-w-full break-all font-mono text-small text-ink-muted">{run.error.path}</p>
          )}
          <Button
            onClick={onRetry}
            disabled={retrying}
            icon={<RotateCw aria-hidden="true" className="size-[20px]" />}
          >
            {retrying ? 'Запускаем…' : 'Повторить расчёт'}
          </Button>
          {retryError !== null && (
            <p role="alert" className="text-small text-status-danger">
              {retryError}
            </p>
          )}
        </>
      ) : (
        <>
          <p className={cx('font-bold text-ink-primary', stacked ? 'text-title-l' : 'text-heading-m')}>
            Расчёт ещё идёт
          </p>
          <p className={cx('text-ink-secondary', stacked ? 'text-small' : 'text-body')}>
            {STAGES[run.stage]} · статус «{runStatusLabel(run.status)}»
          </p>
          <div
            className="h-[10px] w-full max-w-[620px] overflow-hidden rounded-pill bg-chart-empty"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Прогресс расчёта"
          >
            <div
              className="h-full rounded-pill bg-accent-blue transition-[width] duration-200"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <p
            className={cx('font-semibold text-ink-primary', stacked ? 'text-base' : 'text-title-m')}
            data-numeric
          >
            {percent} % · отсчётов {run.completed_ticks} из {run.total_ticks}
          </p>
          <p className="max-w-[62ch] text-small text-ink-muted">
            Страница обновляется сама: состояние запроса опрашивается раз в секунду.
          </p>
        </>
      )}
    </Card>
  );
}
