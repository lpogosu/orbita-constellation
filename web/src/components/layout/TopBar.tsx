import { FolderClosed, Moon, Sun } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cx } from '@/lib/cx';
import { NAV_SECTIONS } from '@/app/sections';
import { useTheme } from '@/theme/use-theme';

/** Шапка макета (Top Bar): бренд, навигация пяти разделов, контекст проекта и тема. */
export function TopBar() {
  const { theme, toggle } = useTheme();

  return (
    <header className="relative h-[92px] shrink-0 border-b border-line-strong bg-[var(--topbar-bg)]">
      <Panorama />

      {/* Ниже 1536 px шапка ужимается: макет нарисован для 1920, но обязан работать с
          1366 без горизонтальной прокрутки. */}
      <div className="relative flex h-full items-center gap-4 px-5 2xl:gap-6 2xl:px-10">
        <div className="flex shrink-0 items-center gap-2.5 2xl:gap-3.5">
          <img
            src="/assets/logo-mark.png"
            alt=""
            className="h-11 w-14 object-contain 2xl:h-[60px] 2xl:w-[78px]"
          />
          <span className="font-display text-[26px] font-bold leading-none tracking-[2px] text-ink-primary 2xl:text-[40px] 2xl:tracking-[3.2px]">
            ОРБИТА
          </span>
        </div>

        <nav aria-label="Разделы" className="flex items-center gap-1 2xl:gap-5">
          {NAV_SECTIONS.map((section) => (
            <NavItem key={section.path} to={section.path} label={section.title} />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-4 2xl:gap-6">
          <ProjectContext />
          <p className="hidden text-micro font-medium tracking-[0.66px] text-ink-primary 2xl:block">
            СВЯЗЬ ДАЛЬШЕ ГРАНИЦ
          </p>
          <button
            type="button"
            onClick={toggle}
            aria-pressed={theme === 'light'}
            className="flex size-12 items-center justify-center rounded-[24px] border border-line bg-surface-raised text-ink-primary transition-colors duration-150 hover:border-line-strong"
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
        </div>
      </div>
    </header>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          'flex flex-col items-center justify-center gap-1 whitespace-nowrap rounded-pill pb-[9px] pt-[11px] text-[17px] font-medium transition-colors duration-150 2xl:text-[22px]',
          isActive
            ? 'border border-line bg-surface-raised px-4 text-ink-primary 2xl:px-[38px]'
            : 'px-3 text-ink-secondary hover:text-ink-primary 2xl:px-[28px]',
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
 * Контекст «Проект › Вариант» (14_SCREENS.md §0.1). На экране «Проекты» проект ещё не
 * открыт, поэтому элемент показан недоступным с объяснением, а не выдуманным названием.
 */
function ProjectContext() {
  return (
    <div
      className="hidden h-11 w-[272px] items-center gap-2 rounded-sm border border-line bg-surface-input px-3.5 opacity-70 2xl:flex"
      title="Откройте проект, чтобы переключать его варианты"
    >
      <FolderClosed aria-hidden="true" className="size-4 text-ink-muted" />
      <span className="text-caption font-medium text-ink-secondary">Проект не выбран</span>
    </div>
  );
}

/** Полярная панорама макета, растянутая по правой половине шапки. */
function Panorama() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-y-0 right-0 w-[60%] bg-cover bg-center"
        style={{ backgroundImage: 'var(--scenery-panorama)' }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, var(--topbar-bg) 0%, var(--topbar-bg) 42%, transparent 78%)',
        }}
      />
    </div>
  );
}
