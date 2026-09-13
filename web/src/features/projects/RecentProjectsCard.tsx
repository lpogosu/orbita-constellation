import { ChevronRight, FolderClosed } from 'lucide-react';

import type { Project } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatUtcMoment } from '@/lib/run-format';

/**
 * Мест в макете ровно четыре: четыре строки по 50 px с шагом 54 внутри 290-пиксельной
 * карточки. Остальные проекты не прячутся — список прокручивается внутри карточки.
 */
const VISIBLE_ROWS = 4;
const ROW_HEIGHT = 50;
const ROW_GAP = 4;
const LIST_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP;

/**
 * В потоке строка выше (56 px — под палец) и видно пять строк. Весь список развернуть
 * нельзя: проектов бывают десятки, и карточка вытолкнула бы остальной экран за десяток
 * экранов прокрутки.
 */
const STACKED_ROW_HEIGHT = 56;
const STACKED_VISIBLE_ROWS = 5;
const STACKED_LIST_HEIGHT =
  STACKED_VISIBLE_ROWS * STACKED_ROW_HEIGHT + (STACKED_VISIBLE_ROWS - 1) * ROW_GAP;

interface RecentProjectsCardProps {
  projects: readonly Project[] | null;
  error: string | null;
  onRetry: () => void;
  onOpen: (project: Project) => void;
}

/** Card / Недавние проекты: 721×290 на (1170, 142), список из `GET /api/projects`. */
export function RecentProjectsCard({ projects, error, onRetry, onOpen }: RecentProjectsCardProps) {
  const stacked = useStacked();

  return (
    <Card
      sceneX={1170}
      sceneY={142}
      className={
        stacked
          ? 'px-[12px] pb-[12px] pt-[16px]'
          : 'absolute left-[1170px] top-[142px] h-[290px] w-[721px]'
      }
    >
      <div
        className={stacked ? 'flex items-baseline justify-between gap-[12px] px-[8px]' : 'contents'}
      >
        <h2
          className={cx(
            'text-title-m font-semibold leading-[26px] text-ink-primary',
            !stacked && 'absolute left-[27px] top-[23px]',
          )}
        >
          Недавние проекты
        </h2>

        {/*
          В макете здесь ссылка «Все проекты ›». Отдельного экрана со списком проектов в
          `14_SCREENS.md` не объявлено, а список внутри карточки и так содержит все
          проекты и прокручивается, поэтому слот занят тем, что ссылка обещала, — счётом.
        */}
        {projects !== null && projects.length > 0 && (
          <p
            className={cx(
              'text-small font-semibold leading-[18px] text-ink-secondary',
              stacked ? 'shrink-0' : 'absolute left-[589px] top-[28px]',
            )}
            data-numeric
          >
            Всего: {projects.length}
          </p>
        )}
      </div>

      <div
        className={stacked ? 'mt-[12px]' : 'absolute left-[19px] top-[65px] w-[687px]'}
        style={
          stacked
            ? { height: projects !== null && projects.length > 0 ? undefined : STACKED_LIST_HEIGHT }
            : { height: LIST_HEIGHT }
        }
      >
        {error !== null && (
          <ErrorBlock title="Список не загрузился" message={error} onRetry={onRetry} />
        )}

        {error === null && projects === null && (
          <LoadingBlock label="Загружаем список проектов">
            <ul className="space-y-[4px]">
              {Array.from({ length: stacked ? STACKED_VISIBLE_ROWS : VISIBLE_ROWS }, (_, index) => (
                <li key={index}>
                  <Skeleton
                    className={
                      stacked
                        ? 'h-[56px] w-full rounded-[14px]'
                        : 'h-[50px] w-[681px] rounded-[14px]'
                    }
                  />
                </li>
              ))}
            </ul>
          </LoadingBlock>
        )}

        {error === null && projects !== null && projects.length === 0 && (
          <EmptyState
            icon={<FolderClosed aria-hidden="true" className="size-[22px]" />}
            title="Проектов пока нет"
            hint="Загрузите сценарий или выберите пример — созданный проект появится здесь."
          />
        )}

        {error === null && projects !== null && projects.length > 0 && (
          <ul
            className={cx('scroll-area space-y-[4px]', stacked ? 'pr-[4px]' : 'h-full')}
            style={stacked ? { maxHeight: STACKED_LIST_HEIGHT } : undefined}
          >
            {projects.map((project) => (
              <li key={project.id}>
                {stacked ? (
                  <StackedProjectRow
                    project={project}
                    onOpen={() => {
                      onOpen(project);
                    }}
                  />
                ) : (
                  <ProjectRow
                    project={project}
                    onOpen={() => {
                      onOpen(project);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * Строка макета: папка, название, серая строка «N вариантов · …», статус, худшая
 * доступность и шеврон. `GET /api/projects` отдаёт только `id`, `title`, `created_at` и
 * `active_variant_id`. Число вариантов в подписи не показывается вовсе: прочерк на его месте
 * («— вариантов») читался как сбой загрузки. Доступность стоит прочерком, как строка
 * «Тест ISL 2000» в макете, а иконка статуса не рисуется, пока статуса нет.
 */
function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block h-[50px] w-[681px] rounded-[14px] text-left transition-colors duration-150 hover:bg-[var(--surface-row-active)]"
    >
      <FolderClosed
        aria-hidden="true"
        className="absolute left-[14px] top-[16px] size-[18px] text-ink-muted"
      />
      <span
        className="absolute left-[44px] top-[7px] block w-[473px] truncate text-[15px] font-semibold leading-[20px] text-ink-primary"
        title={project.title}
      >
        {project.title}
      </span>
      <span className="absolute left-[44px] top-[28px] block w-[473px] truncate text-caption leading-[16px] text-ink-muted">
        создан {formatUtcMoment(project.created_at)}
      </span>
      <span
        className="absolute left-[547px] top-[14px] block w-[90px] text-right text-[15px] font-semibold leading-[20px] text-ink-muted"
        title="Худшая доступность клиента появится, когда список проектов начнёт отдавать метрики расчёта"
      >
        —
      </span>
      <ChevronRight
        aria-hidden="true"
        className="absolute left-[651px] top-[17px] size-[16px] text-ink-muted"
      />
    </button>
  );
}

/**
 * Та же строка в потоке. Прочерк доступности здесь не показан: в узкой колонке он
 * отнимал бы место у названия, а сведений не несёт.
 */
function StackedProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] text-left transition-colors duration-150 hover:bg-[var(--surface-row-active)]"
      style={{ height: STACKED_ROW_HEIGHT }}
    >
      <FolderClosed aria-hidden="true" className="size-[18px] shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[15px] font-semibold leading-[20px] text-ink-primary"
          title={project.title}
        >
          {project.title}
        </span>
        <span className="block truncate text-caption leading-[16px] text-ink-muted">
          создан {formatUtcMoment(project.created_at)}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-[16px] shrink-0 text-ink-muted" />
    </button>
  );
}
