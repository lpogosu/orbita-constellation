import { Eye, SquareArrowOutUpRight } from 'lucide-react';

import { cx } from '@/lib/cx';
import { REPOSITORY_URL } from './mode';

/**
 * Плашка демо. Без неё посетитель ссылки принял бы отказ «Запустить расчёт» за поломку
 * сервиса; ссылка ведёт туда, где описано, как поднять полный стек.
 *
 * На полотне шапка расставлена по координатам и свободного места в ней нет, поэтому
 * плашка висит под её нижней границей, в полосе x = 844…1043, y = 97…121: на всех экранах
 * она пуста — заголовки слева кончаются раньше, карточки и поля начинаются ниже.
 */
export function DemoBadge({ stacked }: { stacked: boolean }) {
  return (
    <a
      href={REPOSITORY_URL}
      target="_blank"
      rel="noreferrer"
      title="Демо показывает записанный расчёт. Исходный код и запуск полного стека — в репозитории"
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-pill border border-line bg-surface-glass text-caption font-semibold text-ink-primary shadow-card transition-colors duration-150 hover:border-line-strong',
        // На полотне ширина ограничена промежутком между заголовками экранов слева и
        // подписью «Состояние сети» на «Отказах» (x = 1050), поэтому отступы плотнее.
        stacked
          ? 'h-[28px] gap-[6px] px-[10px]'
          : 'absolute left-[844px] top-[97px] h-[24px] gap-[4px] px-[8px]',
      )}
    >
      <Eye aria-hidden="true" className="size-[13px] text-accent-cyan" />
      Демо · только просмотр
      <SquareArrowOutUpRight aria-hidden="true" className="size-[12px] text-ink-secondary" />
      <span className="sr-only">— открыть репозиторий на GitHub</span>
    </a>
  );
}
