import { Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { cx } from '@/lib/cx';
import { isSectionActive, NAV_SECTIONS, PROJECTS_PATH, sectionHref } from '@/app/sections';
import { useProjectSelection } from '@/app/project-selection';
import { useTheme } from '@/theme/use-theme';
import { ProjectSwitcher } from './ProjectSwitcher';

/**
 * Top Bar макета: 1920×92, координаты частей — из узла шапки. Ужимать её больше не
 * нужно: полотно целиком масштабируется под окно.
 */
export function TopBar() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const { selection } = useProjectSelection();

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
          <NavItem
            key={section.path}
            /* «Проекты» — список всех, остальные разделы открываются на текущем проекте:
               пункт меню ведёт ровно туда, где пользователь только что работал. */
            to={sectionHref(
              section.path,
              section.path === PROJECTS_PATH ? null : selection.projectId,
            )}
            label={section.title}
            active={isSectionActive(section.path, pathname)}
          />
        ))}
      </nav>

      <ProjectSwitcher />

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

/**
 * Ссылка ведёт на раздел текущего проекта, а адрес активного раздела от неё отличается
 * (проект в пути или в запросе), поэтому подсветку считает не `NavLink` по совпадению
 * адресов, а сам раздел по префиксу пути.
 */
function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex flex-col items-center justify-center gap-[4px] whitespace-nowrap rounded-pill pb-[9px] pt-[11px] text-[22px] font-medium leading-[29px] transition-colors duration-150',
        active
          ? 'border border-line bg-surface-raised px-[38px] text-ink-primary'
          : 'px-[28px] text-ink-secondary hover:text-ink-primary',
      )}
    >
      {label}
      {/* Активный раздел помечен и подложкой, и подчёркиванием: одного цвета мало. */}
      <span
        aria-hidden="true"
        className={cx('h-[3px] w-[52px] rounded-[2px]', active && 'bg-accent-blue')}
      />
    </Link>
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
