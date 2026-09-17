/**
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm ivory paper and deep ink, with a muted sage accent. These are the
        // product-wide tokens: the public landing page and the student app share
        // them so the marketing site never looks like a different company.
        bg: '#F8F5EF',
        ink: '#15233B',
        muted: '#5C6473',
        accent: '#C8755D',
        surface: '#F2EEE5',
        border: '#E7E1D5',
        card: '#FFFDF9',
        success: '#5F7A66',
        nav: '#5C6473',
        // Two supporting tints used by the landing page's editorial sections.
        'ink-soft': '#5C6473',
        'paper': '#FFFDF9',
        'sage-wash': '#E7EDE6',
        'terracotta': '#C8755D',
        'terracotta-dark': '#B4634C',
        'terracotta-tint': '#F4E4DC',
        'sage-tint': '#E7EDE6',
        'line': '#E7E1D5',
        'line-strong': '#D9D1C2',
      },
      fontFamily: {
        // `display` is the editorial serif reserved for the public headlines;
        // the product UI itself stays entirely on the sans stack.
        display: ['Fraunces', 'Iowan Old Style', 'Georgia', 'serif'],
        sora: ['Sora', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        'page-title': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
        'section-title': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }],
        'card-title': ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.005em' }],
        'body': ['1rem', { lineHeight: '1.625rem' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5rem' }],
        'label': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
        'label-lg': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.06em' }],
        // Editorial display scale for the public marketing surface.
        'display-lg': ['2.5rem', { lineHeight: '1.06', letterSpacing: '-0.025em' }],
        'display': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        'display-sm': ['2rem', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
      },
      letterSpacing: {
        'eyebrow': '0.2em',
      },
      maxWidth: {
        content: '1240px',
      },
      borderRadius: {
        DEFAULT: '8px',
        'lg': '12px',
        'xl': '16px',
      },
      boxShadow: {
        DEFAULT: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 2px 4px 0 rgb(0 0 0 / 0.05)',
        lg: '0 4px 6px 0 rgb(0 0 0 / 0.05)',
        xl: '0 8px 12px 0 rgb(0 0 0 / 0.05)',
        'soft': '0 2px 8px 0 rgb(0 0 0 / 0.04)',
        'elevated': '0 4px 16px 0 rgb(0 0 0 / 0.06)',
      },
      spacing: {
        'safe': 'env(safe-area-inset-bottom)',
        '18': '4.5rem',
        '22': '5.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'grow-width': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out forwards',
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'scale-in': 'scale-in 0.5s ease-out forwards',
        'slide-right': 'slide-right 0.5s ease-out forwards',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'slide-in': 'slide-in 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
};
