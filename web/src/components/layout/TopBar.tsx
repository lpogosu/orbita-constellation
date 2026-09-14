import { Moon, SquareArrowOutUpRight, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { cx } from '@/lib/cx';
import { publicPath } from '@/lib/public-path';
import { isSectionActive, NAV_SECTIONS, PROJECTS_PATH, RESULT_PATH, sectionHref } from '@/app/sections';
import { useProjectSelection } from '@/app/project-selection';
import { useStacked } from '@/app/viewport-mode';
import { DemoBadge } from '@/demo/DemoBadge';
import { DEMO_MODE } from '@/demo/mode';
import { useTheme } from '@/theme/use-theme';
import { ProjectSwitcher } from './ProjectSwitcher';

/**
 * Шапка.
 *
 * На полотне это узел макета 1920×92 с абсолютными координатами частей — ужимать её не
 * нужно, полотно масштабируется целиком. В потоке те же координаты означали бы шапку
 * шириной 1920 на экране шириной 390, поэтому там она собирается заново: логотип,
 * прокручиваемый вбок список разделов и переключатель темы.
 */
export function TopBar() {
  const stacked = useStacked();
  return stacked ? <StackedTopBar /> : <CanvasTopBar />;
}

function StackedTopBar() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const { selection } = useProjectSelection();

  return (
    <header className="sticky top-0 z-20 border-b border-line-strong bg-[var(--topbar-bg)]">
      <div className="flex items-center gap-[10px] px-[16px] py-[10px]">
        <img src={publicPath('assets/logo-mark.png')} alt="" className="h-[32px] w-[42px] object-contain" />
        <span className="font-display text-[22px] font-bold leading-none tracking-[1.6px] text-ink-primary">
          ОРБИТА
        </span>

        <button
          type="button"
          onClick={toggle}
          aria-pressed={theme === 'light'}
          className="ml-auto flex size-[38px] items-center justify-center rounded-[19px] border border-line bg-surface-raised text-ink-primary transition-colors duration-150 hover:border-line-strong"
        >
          {theme === 'dark' ? (
            <Moon aria-hidden="true" className="size-[20px]" />
          ) : (
            <Sun aria-hidden="true" className="size-[20px]" />
          )}
          <span className="sr-only">
            {theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          </span>
        </button>
      </div>

      {DEMO_MODE && (
        <div className="px-[16px] pb-[10px]">
          <DemoBadge stacked />
        </div>
      )}

      <div className="px-[16px] pb-[10px]">
        <ProjectSwitcher />
      </div>

      {/* Пять разделов в строку на 390px не помещаются. Горизонтальная прокрутка честнее
          выпадающего меню: все пункты видны сразу и доступны одним движением. */}
      <nav
        aria-label="Разделы"
        className="flex gap-[6px] overflow-x-auto px-[16px] pb-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NAV_SECTIONS.map((section) => {
          const active = isSectionActive(section.path, pathname);
          return (
            <Link
              key={section.path}
              to={sectionHref(
                section.path,
                section.path === PROJECTS_PATH ? null : selection.projectId,
              )}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'shrink-0 whitespace-nowrap rounded-pill px-[14px] py-[7px] text-[15px] font-medium leading-none transition-colors duration-150',
                active
                  ? 'border border-line bg-surface-raised text-ink-primary'
                  : 'text-ink-secondary hover:text-ink-primary',
              )}
            >
              {section.title}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function CanvasTopBar() {
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const { selection } = useProjectSelection();

  return (
    <header className="absolute inset-x-0 top-0 z-10 h-[92px] bg-[var(--topbar-bg)]">
      <Panorama />

      <div aria-hidden="true" className="absolute left-0 top-[91px] h-px w-full bg-line-strong" />

      <div className="absolute left-[40px] top-[16px] flex items-center gap-[14px]">
        <img
          src={publicPath('assets/logo-mark.png')}
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

      {DEMO_MODE && <DemoBadge stacked={false} />}

      {selection.runId === null ? (
        <p className="absolute left-[1555px] top-[36px] h-[20px] w-[220px] text-right text-micro font-medium leading-[22px] text-ink-primary">
          СВЯЗЬ ДАЛЬШЕ ГРАНИЦ
        </p>
      ) : (
        <Link
          to={`${RESULT_PATH}/${encodeURIComponent(selection.runId)}`}
          title="Открыть подробный результат текущего расчёта"
          className="absolute left-[1575px] top-[26px] flex h-[40px] items-center gap-[7px] rounded-sm border border-line bg-surface-raised px-[12px] text-[12px] font-semibold text-ink-primary transition-colors duration-150 hover:border-line-strong"
        >
          {/* Подложка: голый синий текст на сиянии панорамы в тёмной теме не читался. */}
          <SquareArrowOutUpRight aria-hidden="true" className="size-[16px] text-accent-blue" />
          Результат расчёта
        </Link>
      )}

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
