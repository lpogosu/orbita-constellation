import { ChevronRight, FolderClosed, FolderOpen, Moon, Sun } from 'lucide-react';
import { useCallback } from 'react';
import { NavLink } from 'react-router-dom';

import { getProject } from '@/api/projects';
import type { ProjectDetail } from '@/api/types';
import { cx } from '@/lib/cx';
import { NAV_SECTIONS } from '@/app/sections';
import { useProjectSelection } from '@/app/project-selection';
import { Skeleton } from '@/components/state/States';
import { useResource } from '@/lib/use-resource';
import { useTheme } from '@/theme/use-theme';

/**
 * Top Bar макета: 1920×92, координаты частей — из узла шапки. Ужимать её больше не
 * нужно: полотно целиком масштабируется под окно.
 */
export function TopBar() {
  const { theme, toggle } = useTheme();

  return (
    <header className="absolute inset-x-0 top-0 z-10 h-[92px] bg-[var(--topbar-bg)]">
      <Panorama />

      <div aria-hidden="true" className="absolute left-0 top-[91px] h-px w-full bg-line-strong" />

      <div className="absolute left-[40px] top-[16px] flex items-center gap-[14px]">
        <img
          src="/assets/logo-mark.png"
          alt=""
          className="h-[60px] w-[78px] object-contain"
        />
        <span className="font-display text-[40px] font-bold leading-none tracking-[3.2px] text-ink-primary">
          ОРБИТА
        </span>
      </div>

      <nav
        aria-label="Разделы"
        className="absolute left-[352px] top-[19px] flex items-center gap-[20px]"
      >
        {NAV_SECTIONS.map((section) => (
          <NavItem key={section.path} to={section.path} label={section.title} />
        ))}
      </nav>

      <ProjectContext />

      <p className="absolute left-[1555px] top-[36px] h-[20px] w-[220px] text-right text-micro font-medium leading-[22px] text-ink-primary">
        СВЯЗЬ ДАЛЬШЕ ГРАНИЦ
      </p>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={theme === 'light'}
        className="absolute left-[1787px] top-[22px] flex size-[48px] items-center justify-center rounded-[24px] border border-line bg-surface-raised text-ink-primary transition-colors duration-150 hover:border-line-strong"
      >
        {theme === 'dark' ? (
          <Moon aria-hidden="true" className="size-[26px]" />
        ) : (
          <Sun aria-hidden="true" className="size-[26px]" />
        )}
        <span className="sr-only">
          {theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        </span>
      </button>
    </header>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          'flex flex-col items-center justify-center gap-[4px] whitespace-nowrap rounded-pill pb-[9px] pt-[11px] text-[22px] font-medium leading-[29px] transition-colors duration-150',
          isActive
            ? 'border border-line bg-surface-raised px-[38px] text-ink-primary'
            : 'px-[28px] text-ink-secondary hover:text-ink-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {/* Активный раздел помечен и подложкой, и подчёркиванием: одного цвета мало. */}
          <span
            aria-hidden="true"
            className={cx('h-[3px] w-[52px] rounded-[2px]', isActive && 'bg-accent-blue')}
          />
        </>
      )}
    </NavLink>
  );
}

/**
 * Контекст «Проект › Вариант» (14_SCREENS.md §0.1). Пока проект не открыт, элемент
 * недоступен и объясняет почему; на экранах проекта и результата он показывает название
 * из API. Названия не хранятся в контексте выбора, поэтому шапка читает их сама — так
 * страницы не обязаны ничего в него класть, кроме идентификаторов.
 */
function ProjectContext() {
  const { selection } = useProjectSelection();
  const { projectId, variantId } = selection;

  const load = useCallback(
    (): Promise<ProjectDetail | null> =>
      projectId === null ? Promise.resolve(null) : getProject(projectId),
    [projectId],
  );
  const project = useResource<ProjectDetail | null>(load);

  if (projectId === null) {
    return (
      <div
        className="absolute left-[1268px] top-[24px] flex h-[44px] w-[272px] items-center gap-[8px] rounded-sm border border-line bg-surface-input pl-[14px] pr-[12px] opacity-70"
        title="Откройте проект, чтобы переключать его варианты"
      >
        <FolderClosed aria-hidden="true" className="size-[16px] text-ink-muted" />
        <span className="text-[13px] font-medium text-ink-secondary">Проект не выбран</span>
      </div>
    );
  }

  const detail = project.data;
  const variant =
    detail === null ? undefined : detail.variants.find((item) => item.id === variantId);

  return (
    <div className="absolute left-[1268px] top-[24px] flex h-[44px] w-[272px] items-center gap-[8px] rounded-sm border border-line bg-surface-input pl-[14px] pr-[12px]">
      <FolderOpen aria-hidden="true" className="size-[16px] shrink-0 text-ink-secondary" />
      {detail === null && project.error === null && <Skeleton className="h-[16px] w-[200px]" />}
      {project.error !== null && (
        <span className="truncate text-[13px] font-medium text-ink-muted" title={project.error}>
          Проект не загрузился
        </span>
      )}
      {detail !== null && (
        <>
          <span className="truncate text-[13px] font-semibold text-ink-primary">
            {detail.project.title}
          </span>
          <ChevronRight aria-hidden="true" className="size-[14px] shrink-0 text-ink-muted" />
          <span className="truncate text-[13px] font-medium text-ink-secondary">
            {variant?.title ?? 'все варианты'}
          </span>
        </>
      )}
    </div>
  );
}

/** Полярная панорама макета: 1150×92 в правой части шапки, под растворяющей заливкой. */
function Panorama() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-[770px] top-0 h-[92px] w-[1150px]"
        style={{
          backgroundImage: 'var(--scenery-panorama)',
          backgroundSize: '1150px 489px',
          backgroundPosition: '0 -329px',
        }}
      />
      <div className="absolute left-[770px] top-0 h-[92px] w-[1150px] bg-[var(--scrim-panorama)]" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, var(--topbar-bg) 0%, var(--topbar-bg) 42%, color-mix(in srgb, var(--topbar-bg) 70%, transparent) 58%, color-mix(in srgb, var(--topbar-bg) 26%, transparent) 68%, color-mix(in srgb, var(--topbar-bg) 4%, transparent) 78%, transparent 100%)',
        }}
      />
    </div>
  );
}
