import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      // Telas pequenas de verdade (celular em pé) precisam de um ponto próprio:
      // entre 320 e 640 px a diferença de 100 px muda como a linha quebra.
      screens: { xs: '480px' },
      fontFamily: {
        sans: ['var(--font-public-sans)', 'Public Sans', 'Noto Sans', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
          pressed: 'hsl(var(--primary-pressed))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Paleta do sistema: azul institucional, texto em grafite e cinzas frios.
        // (o prefixo `meta` é herdado; os valores abaixo são os que valem)
        meta: {
          blue: '#155399',
          'blue-hover': '#0F4178',
          'blue-pressed': '#0B3260',
          'blue-light': '#4E8AD0',
          charcoal: '#1C2B33',
          slate: '#56677A',
          divider: '#DCE2E9',
          'soft-gray': '#EFF2F6',
          'warm-gray': '#F6F7F9',
          'baby-blue': '#E9F0F9',
          'near-black': '#1C1E21',
        },
      },
      // Cantos discretos: a interface é de trabalho, não de vitrine.
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        card: 'var(--radius-card)',
        feature: 'var(--radius-feature)',
      },
      boxShadow: {
        elevated: '0 16px 40px -8px rgba(16,24,40,0.22), 0 2px 6px 0 rgba(16,24,40,0.08)',
        lift: '0 1px 2px 0 rgba(16,24,40,0.06)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
