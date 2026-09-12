import { ChevronRight, FolderClosed } from 'lucide-react';

import type { Project } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { formatMoment } from '@/lib/format';

/**
 * Сколько строк показывает карточка. `GET /api/projects` отдаёт весь список без
 * пагинации и без параметра `limit`, поэтому ограничение живёт на экране, а число
 * скрытых проектов названо честно.
 */
const RECENT_LIMIT = 6;

interface RecentProjectsCardProps {
  projects: readonly Project[] | null;
  error: string | null;
  onRetry: () => void;
  onOpen: (project: Project) => void;
}

/** Card / Недавние проекты: список `GET /api/projects`, свежие сверху. */
export function RecentProjectsCard({
  projects,
  error,
  onRetry,
  onOpen,
}: RecentProjectsCardProps) {
  return (
    // Карточка не растёт вместе со списком: она отдаёт высоту карточке сценария, а
    // список прокручивается внутри.
    <Card className="max-h-[176px] shrink-0 overflow-hidden 2xl:max-h-[290px]">
      <div className="flex h-full flex-col p-[19px]">
        <h2 className="shrink-0 px-2 pb-3 pt-1 text-title-m font-semibold text-ink-primary">
          Недавние проекты
        </h2>

        {error !== null && (
          <ErrorBlock title="Список не загрузился" message={error} onRetry={onRetry} />
        )}

        {error === null && projects === null && (
          <LoadingBlock label="Загружаем список проектов">
            <ul className="space-y-1">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index}>
                  <Skeleton className="h-[50px] w-full rounded-sm" />
                </li>
              ))}
            </ul>
          </LoadingBlock>
        )}

        {error === null && projects !== null && projects.length === 0 && (
          <EmptyState
            icon={<FolderClosed aria-hidden="true" className="size-6" />}
            title="Проектов пока нет"
            hint="Загрузите сценарий или выберите пример — созданный проект появится здесь."
          />
        )}

        {error === null && projects !== null && projects.length > 0 && (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {projects.slice(0, RECENT_LIMIT).map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpen(project);
                  }}
                  className="flex w-full items-center gap-3 rounded-sm px-3.5 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-row-active)]"
                >
                  <FolderClosed aria-hidden="true" className="size-[18px] text-ink-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink-primary">
                      {project.title}
                    </span>
                    <span className="block truncate text-caption text-ink-muted">
                      создан {formatMoment(project.created_at)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-ink-muted" />
                </button>
              </li>
            ))}
            {projects.length > RECENT_LIMIT && (
              <li className="px-3.5 pt-2 text-caption text-ink-muted" data-numeric>
                Показаны {RECENT_LIMIT} последних из {projects.length}
              </li>
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
