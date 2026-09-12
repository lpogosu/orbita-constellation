import { ChevronRight, FolderClosed } from 'lucide-react';

import type { Project } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { formatMoment } from '@/lib/format';

/**
 * Мест в макете ровно четыре: четыре строки по 50 px с шагом 54 внутри 290-пиксельной
 * карточки. Остальные проекты не прячутся — список прокручивается внутри карточки.
 */
const VISIBLE_ROWS = 4;
const ROW_HEIGHT = 50;
const ROW_GAP = 4;
const LIST_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP;

interface RecentProjectsCardProps {
  projects: readonly Project[] | null;
  error: string | null;
  onRetry: () => void;
  onOpen: (project: Project) => void;
}

/** Card / Недавние проекты: 721×290 на (1170, 142), список из `GET /api/projects`. */
export function RecentProjectsCard({ projects, error, onRetry, onOpen }: RecentProjectsCardProps) {
  return (
    <Card
      sceneX={1170}
      sceneY={142}
      className="absolute left-[1170px] top-[142px] h-[290px] w-[721px]"
    >
      <h2 className="absolute left-[27px] top-[23px] text-title-m font-semibold leading-[26px] text-ink-primary">
        Недавние проекты
      </h2>

      {/*
        В макете здесь ссылка «Все проекты ›». Отдельного экрана со списком проектов в
        `14_SCREENS.md` не объявлено, а список внутри карточки и так содержит все
        проекты и прокручивается, поэтому слот занят тем, что ссылка обещала, — счётом.
      */}
      {projects !== null && projects.length > 0 && (
        <p
          className="absolute left-[589px] top-[28px] text-small font-semibold leading-[18px] text-ink-secondary"
          data-numeric
        >
          Всего: {projects.length}
        </p>
      )}

      <div className="absolute left-[19px] top-[65px] w-[687px]" style={{ height: LIST_HEIGHT }}>
        {error !== null && (
          <ErrorBlock title="Список не загрузился" message={error} onRetry={onRetry} />
        )}

        {error === null && projects === null && (
          <LoadingBlock label="Загружаем список проектов">
            <ul className="space-y-[4px]">
              {Array.from({ length: VISIBLE_ROWS }, (_, index) => (
                <li key={index}>
                  <Skeleton className="h-[50px] w-[681px] rounded-[14px]" />
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
          <ul className="scroll-area h-full space-y-[4px]">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  onOpen={() => {
                    onOpen(project);
                  }}
                />
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
 * `active_variant_id`, поэтому число вариантов и доступность стоят прочерком — как строка
 * «Тест ISL 2000» в макете, — а иконка статуса не рисуется, пока статуса нет.
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
      <span className="absolute left-[44px] top-[7px] block w-[473px] truncate text-[15px] font-semibold leading-[20px] text-ink-primary">
        {project.title}
      </span>
      <span className="absolute left-[44px] top-[28px] block w-[473px] truncate text-caption leading-[16px] text-ink-muted">
        — вариантов · создан {formatMoment(project.created_at)}
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
