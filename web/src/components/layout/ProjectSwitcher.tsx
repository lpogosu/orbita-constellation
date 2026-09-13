import { Check, ChevronDown, ChevronRight, FolderClosed, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import { getProject } from '@/api/projects';
import type { Project, ProjectDetail } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { useStacked } from '@/app/viewport-mode';
import { NETWORK_PATH, OUTAGES_PATH, PROJECTS_PATH, sectionHref, sectionOfPath } from '@/app/sections';
import { ErrorBlock, Skeleton } from '@/components/state/States';
import { cx } from '@/lib/cx';
import { describe, useResource } from '@/lib/use-resource';

const BOX = 'absolute left-[1268px] top-[24px] h-[44px] w-[272px]';
/** В потоке переключатель занимает строку шапки целиком: на телефоне это главный
 * способ сменить проект, прятать его в меню незачем. */
const STACKED_BOX = 'relative h-[44px] w-full';

/**
 * Переключатель «Проект › Вариант» из шапки макета (14_SCREENS.md §0.1). Названия не
 * хранятся в контексте выбора — шапка читает их сама, поэтому ни один экран не обязан
 * класть в контекст что-то кроме идентификаторов.
 */
export function ProjectSwitcher() {
  const { selection, select } = useProjectSelection();
  const stacked = useStacked();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, variantId } = selection;

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const loadDetail = useCallback(
    (): Promise<ProjectDetail | null> =>
      projectId === null ? Promise.resolve(null) : getProject(projectId),
    [projectId],
  );
  const detail = useResource<ProjectDetail | null>(loadDetail);

  // Список проектов нужен только раскрытому меню: шапка есть на каждом экране, а лишний
  // запрос на каждом переходе — нет. Каждое открытие перезапрашивает его: шапка живёт
  // всё время работы, и сохранённый список не увидел бы проект, созданный после.
  const [projects, setProjects] = useState<readonly Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    setProjects(null);
    setProjectsError(null);
    void api.listProjects().then(setProjects, (cause: unknown) => {
      setProjectsError(describe(cause));
    });
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    loadProjects();
  }, [loadProjects, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target) !== true) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pickProject = useCallback(
    (project: Project) => {
      setOpen(false);
      select({ projectId: project.id, variantId: null, runId: null });
      // Пользователь остаётся в разделе, в котором работал; вне разделов (экран
      // результата) выбранный проект открывается на своей странице.
      const base = sectionOfPath(location.pathname)?.path ?? PROJECTS_PATH;
      navigate(sectionHref(base, project.id));
    },
    [location.pathname, navigate, select],
  );

  const pickVariant = useCallback(
    (nextVariantId: string) => {
      setOpen(false);
      if (projectId === null) {
        return;
      }
      select({ projectId, variantId: nextVariantId, runId: null });
      // Вариант читают из запроса адреса только «Сеть» и «Отказы» — в остальных разделах
      // показывать его негде, и выбор ведёт на «Сеть», где вариант и правят.
      const base = sectionOfPath(location.pathname)?.path === OUTAGES_PATH ? OUTAGES_PATH : NETWORK_PATH;
      navigate(`${base}/${encodeURIComponent(projectId)}?variant=${encodeURIComponent(nextVariantId)}`);
    },
    [location.pathname, navigate, projectId, select],
  );

  const project = detail.data;
  const variant = project?.variants.find((item) => item.id === variantId);
  // Базовый вариант часто называется так же, как проект. Два одинаковых названия
  // подряд превращали компактную шапку в дёргающуюся «хлебную крошку» при каждом
  // обновлении черновика, не добавляя информации.
  const showVariant = variant !== undefined && variant.title !== project?.project.title;

  return (
    <div ref={root} className={stacked ? STACKED_BOX : BOX}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        className={cx(
          'flex h-full w-full items-center gap-[8px] rounded-sm border bg-surface-input pl-[14px] pr-[10px] text-left transition-colors duration-150',
          open ? 'border-accent-blue' : 'border-line hover:border-line-strong',
        )}
      >
        {projectId === null ? (
          <>
            <FolderClosed aria-hidden="true" className="size-[16px] shrink-0 text-ink-muted" />
            <span className="flex-1 text-[13px] font-medium text-ink-secondary">
              Проект не выбран
            </span>
          </>
        ) : (
          <>
            <FolderOpen aria-hidden="true" className="size-[16px] shrink-0 text-ink-secondary" />
            {project === null && detail.error === null && <Skeleton className="h-[16px] flex-1" />}
            {detail.error !== null && (
              <span
                className="flex-1 truncate text-[13px] font-medium text-ink-muted"
                title={detail.error}
              >
                Проект не загрузился
              </span>
            )}
            {project !== null && (
              <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[6px]">
                <span className="truncate text-[13px] font-semibold text-ink-primary">
                  {project.project.title}
                </span>
                {showVariant && (
                  <>
                    <ChevronRight aria-hidden="true" className="size-[14px] shrink-0 text-ink-muted" />
                    <span className="truncate text-[13px] font-medium text-ink-secondary">
                      {variant.title}
                    </span>
                  </>
                )}
              </span>
            )}
          </>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cx(
            'size-[16px] shrink-0 text-ink-muted transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
        <span className="sr-only">Выбрать проект и вариант</span>
      </button>

      {open && (
        <div
          className={cx(
            'absolute left-0 top-[52px] z-30 rounded-md border border-line bg-surface-raised p-[14px] shadow-card',
            stacked ? 'max-h-[70vh] w-full overflow-y-auto' : 'w-[392px]',
          )}
        >
          <Group title="Проект">
            {projectsError !== null && (
              <div className="h-[120px]">
                <ErrorBlock
                  title="Список не загрузился"
                  message={projectsError}
                  onRetry={loadProjects}
                  compact
                />
              </div>
            )}
            {projectsError === null && projects === null && (
              <ul className="space-y-[4px]" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <li key={index}>
                    <Skeleton className="h-[34px] w-full" />
                  </li>
                ))}
              </ul>
            )}
            {projectsError === null && projects !== null && projects.length === 0 && (
              <p className="px-[10px] py-[8px] text-caption text-ink-muted">
                Проектов ещё нет — загрузите сценарий на экране «Проекты».
              </p>
            )}
            {projectsError === null && projects !== null && projects.length > 0 && (
              <ul className="scroll-area max-h-[170px] space-y-[4px] pr-[4px]">
                {projects.map((item) => (
                  <li key={item.id}>
                    <Option
                      label={item.title}
                      selected={item.id === projectId}
                      onSelect={() => {
                        pickProject(item);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Group>

          <Group title="Вариант">
            {projectId === null && (
              <p className="px-[10px] py-[8px] text-caption text-ink-muted">
                Варианты появятся, когда будет выбран проект.
              </p>
            )}
            {projectId !== null && project === null && detail.error === null && (
              <ul className="space-y-[4px]" aria-hidden="true">
                {Array.from({ length: 2 }, (_, index) => (
                  <li key={index}>
                    <Skeleton className="h-[34px] w-full" />
                  </li>
                ))}
              </ul>
            )}
            {projectId !== null && detail.error !== null && (
              <div className="h-[120px]">
                <ErrorBlock
                  title="Варианты не загрузились"
                  message={detail.error}
                  onRetry={detail.reload}
                  compact
                />
              </div>
            )}
            {project !== null && (
              <ul className="scroll-area max-h-[170px] space-y-[4px] pr-[4px]">
                {project.variants.map((item) => (
                  <li key={item.id}>
                    <Option
                      label={item.title}
                      selected={item.id === variantId}
                      onSelect={() => {
                        pickVariant(item.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-[12px] last:mb-0">
      <h2 className="mb-[6px] px-[10px] text-micro font-semibold uppercase text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Option({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cx(
        'flex h-[34px] w-full items-center gap-[8px] rounded-sm px-[10px] text-left text-small transition-colors duration-150',
        selected
          ? 'bg-[var(--surface-row-active)] font-semibold text-ink-primary'
          : 'text-ink-secondary hover:bg-[var(--surface-row-active)] hover:text-ink-primary',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check aria-hidden="true" className="size-[15px] shrink-0 text-accent-blue" />}
    </button>
  );
}
