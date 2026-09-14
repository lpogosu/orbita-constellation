import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

import { readableTextSizeCss } from './src/styles/readable-text';

interface FontSizeOptions {
  lineHeight?: string;
  letterSpacing?: string;
}

type FontSizeValue = string | [string, FontSizeOptions];

/** Кегль с компенсацией для пиксельных размеров; остальные единицы не трогаются. */
function fontSize(size: string): string {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(size)?.[1];
  return px === undefined ? size : readableTextSizeCss(Number(px));
}

/**
 * Типографика полотна: `text-*`, `leading-*`, `tracking-*` с компенсацией мелкого текста
 * (`src/styles/readable-text.ts`) — и для ступеней шкалы, и для произвольных `text-[13px]`
 * из разметки, так что новый размер получает её без отдельной записи.
 *
 * Встроенная `text-*` заменена целиком, а не дополнена: второй плагин с тем же префиксом
 * делает произвольные значения неоднозначными, и Tailwind молча перестаёт их генерировать.
 * `leading-*` и `tracking-*` переехали сюда вместе с ней: правила плагинов идут после
 * встроенных, и без переезда интерлиньяж и трекинг ступени шкалы перебивали бы
 * `leading-[13px]` и `tracking-[0.8px]` из разметки. Порядок этих трёх утилит между собой —
 * тот же, что у встроенных.
 */
const canvasTypography = plugin((api) => {
  api.matchUtilities<FontSizeValue>(
    {
      text: (value, { modifier }) => {
        const [size, options] = Array.isArray(value) ? value : [value, {}];
        if (modifier !== null) {
          return { 'font-size': fontSize(size), 'line-height': modifier };
        }
        return {
          'font-size': fontSize(size),
          ...(options.lineHeight === undefined ? {} : { 'line-height': options.lineHeight }),
          ...(options.letterSpacing === undefined ? {} : { 'letter-spacing': options.letterSpacing }),
        };
      },
    },
    {
      values: api.theme('fontSize'),
      modifiers: api.theme('lineHeight'),
      type: ['absolute-size', 'relative-size', 'length', 'percentage'],
    },
  );
  api.matchUtilities(
    { leading: (value) => ({ 'line-height': value }) },
    { values: api.theme<Record<string, string>>('lineHeight') },
  );
  api.matchUtilities(
    { tracking: (value) => ({ 'letter-spacing': value }) },
    { values: api.theme<Record<string, string>>('letterSpacing'), supportsNegativeValues: true },
  );
});

/**
 * Все значения — ссылки на CSS-переменные из `src/styles/tokens.css`. Переключение темы
 * меняет переменные, а не классы компонентов, поэтому светлая тема не требует ни одного
 * правила `dark:` в разметке.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        surface: {
          raised: 'var(--surface-raised)',
          input: 'var(--surface-input)',
          sunken: 'var(--surface-sunken)',
          glass: 'var(--surface-glass)',
          chip: 'var(--surface-chip)',
          track: 'var(--surface-track)',
          rowActive: 'var(--surface-row-active)',
        },
        line: {
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
          divider: 'var(--border-divider)',
          subtle: 'var(--border-subtle)',
        },
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          onAccent: 'var(--text-on-accent)',
        },
        accent: {
          blue: 'var(--accent-blue)',
          violet: 'var(--accent-violet)',
          'violet-light': 'var(--accent-violet-light)',
          cyan: 'var(--accent-cyan)',
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          danger: 'var(--status-danger)',
          neutral: 'var(--status-neutral)',
        },
        chart: {
          ok: 'var(--chart-ok)',
          empty: 'var(--chart-empty)',
        },
      },
      backgroundImage: {
        'accent-violet': 'var(--gradient-violet)',
        'accent-magenta': 'var(--gradient-magenta)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'glow-violet': 'var(--shadow-glow-violet)',
        'glow-magenta': 'var(--shadow-glow-magenta)',
        'glow-blue': 'var(--shadow-glow-blue)',
        'glow-cyan': 'var(--shadow-glow-cyan)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
        script: 'var(--font-script)',
      },
      fontSize: {
        // Шкала макета: восемь ступеней, ни одного размера мимо неё.
        micro: ['11px', { lineHeight: '1.4', letterSpacing: '0.66px' }],
        caption: ['12px', { lineHeight: '1.4' }],
        small: ['14px', { lineHeight: '1.4' }],
        base: ['17px', { lineHeight: '1.45' }],
        body: ['19px', { lineHeight: '1.45' }],
        'title-m': ['20px', { lineHeight: '1.3' }],
        'title-l': ['24px', { lineHeight: '1.3' }],
        'heading-m': ['32px', { lineHeight: '1.2', letterSpacing: '-0.4px' }],
        'heading-xl': ['60px', { lineHeight: '1.1', letterSpacing: '-1.2px' }],
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
    },
  },
  corePlugins: {
    fontSize: false,
    lineHeight: false,
    letterSpacing: false,
  },
  plugins: [canvasTypography],
};

export default config;
