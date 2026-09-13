import { ChevronRight, FolderClosed, FolderOpen, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { api } from '@/api/client';
import type { Project } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { PROJECTS_PATH, sectionHref } from '@/app/sections';
import type { Section } from '@/app/sections';
import { useStacked } from '@/app/viewport-mode';
import { PageRoot } from '@/components/layout/Slot';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatMoment } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

const LIST = { x: 26, y: 290, width: 1160, height: 620 } as const;
const ASIDE = { x: 1218, y: 290, width: 676, height: 260 } as const;

/** Высота строки и зазор: семь строк помещаются в карточку, остальные прокручиваются. */
const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const VISIBLE_ROWS = 7;

/**
 * В потоке видно шесть строк. Весь список не разворачивается: проектов бывают десятки,
 * и карточка «Нужного проекта нет» ушла бы на телефоне за несколько экранов прокрутки.
 */
const STACKED_VISIBLE_ROWS = 6;
const STACKED_LIST_HEIGHT =
  STACKED_VISIBLE_ROWS * ROW_HEIGHT + (STACKED_VISIBLE_ROWS - 1) * ROW_GAP;

/**
 * Раздел открыт без проекта. Показывать здесь нечего — все четыре раздела считают по
 * одному проекту, — поэтому экран не объясняет отсутствие данных, а даёт их выбрать:
 * список проектов ведёт в тот же раздел, а соседняя карточка — за новым сценарием.
 *
 * В потоке на планшете список и карточка нового сценария стоят рядом, на телефоне —
 * друг под другом.
 */
export function SelectProject({ section }: { section: Section }) {
  const projects = useResource<Project[]>(api.listProjects);
  const { select } = useProjectSelection();
  const stacked = useStacked();

  return (
    <PageRoot
      canvasClassName="absolute inset-0"
      className="md:grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start"
    >
      <div className={stacked ? 'md:col-span-2' : 'contents'}>
        <h1
          className={cx(
            'font-bold text-ink-primary',
            stacked ? 'text-heading-m' : 'absolute left-[44px] top-[124px] text-heading-xl',
          )}
        >
          Выберите проект
        </h1>
        <p
          className={cx(
            'text-ink-secondary',
            stacked
              ? 'mt-[4px] text-base'
              : 'absolute left-[44px] top-[203px] w-[1160px] text-title-l leading-[34px]',
          )}
        >
          Раздел «{section.title}» считает по одному проекту. {section.purpose}
        </p>
      </div>

      <Card
        sceneX={LIST.x}
        sceneY={LIST.y}
        className={stacked ? 'px-[12px] pb-[12px] pt-[16px]' : 'absolute'}
        style={
          stacked
            ? undefined
            : { left: LIST.x, top: LIST.y, width: LIST.width, height: LIST.height }
        }
      >
        <div
          className={
            stacked ? 'flex items-baseline justify-between gap-[12px] px-[8px]' : 'contents'
          }
        >
          <h2
            className={cx(
              'text-title-m font-semibold text-ink-primary',
              !stacked && 'absolute left-[27px] top-[23px]',
            )}
          >
            Проекты
          </h2>
          {projects.data !== null && projects.data.length > 0 && (
            <p
              className={cx(
                'text-small text-ink-secondary',
                stacked ? 'shrink-0' : 'absolute left-[27px] top-[55px]',
              )}
              data-numeric
            >
              Всего: {projects.data.length}
            </p>
          )}
        </div>

        <div
          className={stacked ? 'mt-[12px]' : 'absolute left-[19px] top-[88px]'}
          style={
            stacked
              ? {
                  height:
                    projects.data !== null && projects.data.length > 0
                      ? undefined
                      : STACKED_LIST_HEIGHT,
                }
              : {
                  width: LIST.width - 38,
                  height: VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP,
                }
          }
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
                {Array.from(
                  { length: stacked ? STACKED_VISIBLE_ROWS : VISIBLE_ROWS },
                  (_, index) => (
                    <li key={index}>
                      <Skeleton className="h-[64px] w-full rounded-md" />
                    </li>
                  ),
                )}
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
            <ul
              className={cx('scroll-area space-y-[8px]', stacked ? 'pr-[4px]' : 'h-full pr-[6px]')}
              style={stacked ? { maxHeight: STACKED_LIST_HEIGHT } : undefined}
            >
              {projects.data.map((project) => (
                <li key={project.id}>
                  <ProjectRow
                    project={project}
                    href={sectionHref(section.path, project.id)}
                    sectionTitle={section.title}
                    stacked={stacked}
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
        className={stacked ? 'p-[20px]' : 'absolute'}
        style={
          stacked
            ? undefined
            : { left: ASIDE.x, top: ASIDE.y, width: ASIDE.width, height: ASIDE.height }
        }
      >
        <h2
          className={cx(
            'text-title-m font-semibold text-ink-primary',
            !stacked && 'absolute left-[27px] top-[23px]',
          )}
        >
          Нужного проекта нет
        </h2>
        <p
          className={cx(
            'text-small leading-[22px] text-ink-secondary',
            stacked ? 'mt-[8px]' : 'absolute left-[27px] top-[63px] w-[600px]',
          )}
        >
          Проект создаётся из файла сценария. Загрузите JSON или возьмите готовый пример — после
          проверки он откроется в разделе «Сеть».
        </p>
        <Link
          to={PROJECTS_PATH}
          className={cx(
            'inline-flex items-center gap-3 rounded-md bg-accent-violet font-semibold text-ink-onAccent shadow-glow-violet transition-[filter] duration-150 hover:brightness-110',
            stacked
              ? 'mt-[20px] h-[52px] w-full justify-center px-[20px] text-base'
              : 'absolute left-[27px] top-[160px] h-[60px] px-[28px] text-body',
          )}
        >
          <Plus aria-hidden="true" className="size-5" />
          Загрузить сценарий
        </Link>
      </Card>
    </PageRoot>
  );
}

function ProjectRow({
  project,
  href,
  sectionTitle,
  stacked,
  onOpen,
}: {
  project: Project;
  href: string;
  sectionTitle: string;
  stacked: boolean;
  onOpen: () => void;
}) {
  return (
    <Link
      to={href}
      onClick={onOpen}
      aria-label={stacked ? `${project.title} — открыть в разделе «${sectionTitle}»` : undefined}
      className={cx(
        'flex items-center rounded-md border border-line transition-colors duration-150 hover:border-line-strong hover:bg-[var(--surface-row-active)]',
        stacked ? 'gap-[12px] px-[14px]' : 'gap-[14px] px-[18px]',
      )}
      style={{ height: ROW_HEIGHT }}
    >
      <FolderOpen aria-hidden="true" className="size-[20px] shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-base font-semibold text-ink-primary"
          title={project.title}
        >
          {project.title}
        </span>
        <span className="block truncate text-caption text-ink-muted">
          создан {formatMoment(project.created_at)}
        </span>
      </span>
      {/* Кнопка-пилюля с названием раздела в колонку телефона не помещается рядом с
          названием проекта: там строка сама ведёт в раздел, а направление показывает
          шеврон. */}
      {stacked ? (
        <ChevronRight aria-hidden="true" className="size-[18px] shrink-0 text-ink-muted" />
      ) : (
        <span className="shrink-0 rounded-pill border border-line bg-surface-raised px-[18px] py-[8px] text-small font-semibold text-ink-primary">
          Открыть в разделе «{sectionTitle}»
        </span>
      )}
    </Link>
  );
}
