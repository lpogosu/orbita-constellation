import type { Config } from 'tailwindcss';

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
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          danger: 'var(--status-danger)',
        },
        chart: {
          ok: 'var(--chart-ok)',
          noClient: 'var(--chart-no-client)',
          noGateway: 'var(--chart-no-gateway)',
          gatewayOutage: 'var(--chart-gateway-outage)',
          partition: 'var(--chart-partition)',
          internal: 'var(--chart-internal)',
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
  plugins: [],
};

export default config;
