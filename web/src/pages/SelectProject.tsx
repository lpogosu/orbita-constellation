import { FolderClosed, FolderOpen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { api } from '@/api/client';
import type { Project } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { PROJECTS_PATH, sectionHref } from '@/app/sections';
import type { Section } from '@/app/sections';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { formatMoment } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

const LIST = { x: 26, y: 290, width: 1160, height: 620 } as const;
const ASIDE = { x: 1218, y: 290, width: 676, height: 260 } as const;

/** Высота строки и зазор: семь строк помещаются в карточку, остальные прокручиваются. */
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const VISIBLE_ROWS = 7;

/**
 * Раздел открыт без проекта. Показывать здесь нечего — все четыре раздела считают по
 * одному проекту, — поэтому экран не объясняет отсутствие данных, а даёт их выбрать:
 * список проектов ведёт в тот же раздел, а соседняя карточка — за новым сценарием.
 */
export function SelectProject({ section }: { section: Section }) {
  const projects = useResource<Project[]>(api.listProjects);
  const { select } = useProjectSelection();

  return (
    <div className="absolute inset-0">
      <h1 className="absolute left-[44px] top-[124px] text-heading-xl font-bold text-ink-primary">
        Выберите проект
      </h1>
      <p className="absolute left-[44px] top-[203px] w-[1160px] text-title-l leading-[34px] text-ink-secondary">
        Раздел «{section.title}» считает по одному проекту. {section.purpose}
      </p>

      <Card
        sceneX={LIST.x}
        sceneY={LIST.y}
        className="absolute"
        style={{ left: LIST.x, top: LIST.y, width: LIST.width, height: LIST.height }}
      >
        <h2 className="absolute left-[27px] top-[23px] text-title-m font-semibold text-ink-primary">
          Проекты
        </h2>
        {projects.data !== null && projects.data.length > 0 && (
          <p
            className="absolute left-[27px] top-[55px] text-small text-ink-secondary"
            data-numeric
          >
            Всего: {projects.data.length}
          </p>
        )}

        <div
          className="absolute left-[19px] top-[88px]"
          style={{
            width: LIST.width - 38,
            height: VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP,
          }}
        >
          {projects.error !== null && (
            <ErrorBlock
              title="Список проектов не загрузился"
              message={projects.error}
              onRetry={projects.reload}
            />
          )}

          {projects.error === null && projects.data === null && (
            <LoadingBlock label="Загружаем список проектов">
              <ul className="space-y-[8px]">
                {Array.from({ length: VISIBLE_ROWS }, (_, index) => (
                  <li key={index}>
                    <Skeleton className="h-[64px] w-full rounded-md" />
                  </li>
                ))}
              </ul>
            </LoadingBlock>
          )}

          {projects.error === null && projects.data !== null && projects.data.length === 0 && (
            <EmptyState
              icon={<FolderClosed aria-hidden="true" className="size-[22px]" />}
              title="Проектов пока нет"
              hint="Загрузите сценарий на экране «Проекты» — созданный проект появится здесь и откроется в этом разделе."
            />
          )}

          {projects.error === null && projects.data !== null && projects.data.length > 0 && (
            <ul className="scroll-area h-full space-y-[8px] pr-[6px]">
              {projects.data.map((project) => (
                <li key={project.id}>
                  <ProjectRow
                    project={project}
                    href={sectionHref(section.path, project.id)}
                    sectionTitle={section.title}
                    onOpen={() => {
                      // Контекст ставится по клику, а не только загрузкой экрана: шапка
                      // обязана показать проект даже если раздел не смог загрузить данные.
                      select({ projectId: project.id, variantId: null, runId: null });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card
        sceneX={ASIDE.x}
        sceneY={ASIDE.y}
        className="absolute"
        style={{ left: ASIDE.x, top: ASIDE.y, width: ASIDE.width, height: ASIDE.height }}
      >
        <h2 className="absolute left-[27px] top-[23px] text-title-m font-semibold text-ink-primary">
          Нужного проекта нет
        </h2>
        <p className="absolute left-[27px] top-[63px] w-[600px] text-small leading-[22px] text-ink-secondary">
          Проект создаётся из файла сценария. Загрузите JSON или возьмите готовый пример —
          после проверки он откроется в разделе «Сеть».
        </p>
        <Link
          to={PROJECTS_PATH}
          className="absolute left-[27px] top-[160px] inline-flex h-[60px] items-center gap-3 rounded-md bg-accent-violet px-[28px] text-body font-semibold text-ink-onAccent shadow-glow-violet transition-[filter] duration-150 hover:brightness-110"
        >
          <Plus aria-hidden="true" className="size-5" />
          Загрузить сценарий
        </Link>
      </Card>
    </div>
  );
}

function ProjectRow({
  project,
  href,
  sectionTitle,
  onOpen,
}: {
  project: Project;
  href: string;
  sectionTitle: string;
  onOpen: () => void;
}) {
  return (
    <Link
      to={href}
      onClick={onOpen}
      className="flex items-center gap-[14px] rounded-md border border-line px-[18px] transition-colors duration-150 hover:border-line-strong hover:bg-[var(--surface-row-active)]"
      style={{ height: ROW_HEIGHT }}
    >
      <FolderOpen aria-hidden="true" className="size-[20px] shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink-primary">
          {project.title}
        </span>
        <span className="block truncate text-caption text-ink-muted">
          создан {formatMoment(project.created_at)}
        </span>
      </span>
      <span className="shrink-0 rounded-pill border border-line bg-surface-raised px-[18px] py-[8px] text-small font-semibold text-ink-primary">
        Открыть в разделе «{sectionTitle}»
      </span>
    </Link>
  );
}
