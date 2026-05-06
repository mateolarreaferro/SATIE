import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { FONT, RADIUS } from '../../theme/tokens';

export type PillVariant = 'default' | 'outline' | 'inverted' | 'overlay';

export type PillSize = 'sm' | 'md' | 'lg';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillVariant;
  size?: PillSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const HEIGHT: Record<PillSize, number> = { sm: 24, md: 30, lg: 36 };
const PAD_X: Record<PillSize, number> = { sm: 10, md: 14, lg: 18 };
const FONT_SIZE: Record<PillSize, number> = {
  sm: FONT.size.xs,
  md: FONT.size.sm,
  lg: FONT.size.body,
};

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  {
    variant = 'default',
    size = 'md',
    iconLeft,
    iconRight,
    disabled,
    style,
    children,
    ...rest
  },
  ref,
) {
  const { theme } = useTheme();

  const palettes: Record<PillVariant, CSSProperties> = {
    default: {
      background: theme.cardBg,
      color: theme.text,
      border: `1px solid ${theme.cardBorder}`,
    },
    outline: {
      background: 'transparent',
      color: theme.text,
      border: `1px solid ${theme.border}`,
    },
    inverted: {
      background: theme.invertedBg,
      color: theme.invertedText,
      border: `1px solid ${theme.invertedBg}`,
    },
    overlay: {
      background: theme.overlayBg,
      color: theme.overlayText,
      border: `1px solid ${theme.overlayBorder}`,
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
    },
  };

  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: HEIGHT[size],
    padding: `0 ${PAD_X[size]}px`,
    borderRadius: RADIUS.pill,
    fontFamily: 'inherit',
    fontSize: FONT_SIZE[size],
    fontWeight: FONT.weight.medium,
    lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity 0.15s, transform 0.15s, background 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    ...palettes[variant],
    ...style,
  };

  return (
    <button ref={ref} disabled={disabled} style={baseStyle} {...rest}>
      {iconLeft && <span style={{ display: 'inline-flex' }}>{iconLeft}</span>}
      {children}
      {iconRight && <span style={{ display: 'inline-flex' }}>{iconRight}</span>}
    </button>
  );
});
