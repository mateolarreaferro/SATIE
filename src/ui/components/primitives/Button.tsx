import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { FONT, RADIUS } from '../../theme/tokens';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'inverted';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  rounded?: 'md' | 'pill';
}

const HEIGHT: Record<ButtonSize, number> = { sm: 28, md: 36, lg: 44 };
const PAD_X: Record<ButtonSize, number> = { sm: 10, md: 14, lg: 18 };
const FONT_SIZE: Record<ButtonSize, number> = {
  sm: FONT.size.sm,
  md: FONT.size.body,
  lg: FONT.size.md,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    iconLeft,
    iconRight,
    loading = false,
    rounded = 'md',
    disabled,
    style,
    children,
    ...rest
  },
  ref,
) {
  const { theme } = useTheme();

  const palettes: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: theme.accent,
      color: theme.accentText,
      border: `1px solid ${theme.accent}`,
    },
    secondary: {
      background: theme.cardBg,
      color: theme.text,
      border: `1px solid ${theme.cardBorder}`,
    },
    ghost: {
      background: 'transparent',
      color: theme.text,
      border: '1px solid transparent',
    },
    destructive: {
      background: theme.danger,
      color: '#faf9f6',
      border: `1px solid ${theme.danger}`,
    },
    inverted: {
      background: theme.invertedBg,
      color: theme.invertedText,
      border: `1px solid ${theme.invertedBg}`,
    },
  };

  const isDisabled = disabled || loading;

  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: HEIGHT[size],
    padding: `0 ${PAD_X[size]}px`,
    borderRadius: rounded === 'pill' ? RADIUS.pill : RADIUS.md,
    fontFamily: 'inherit',
    fontSize: FONT_SIZE[size],
    fontWeight: FONT.weight.medium,
    lineHeight: 1,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.55 : 1,
    transition: 'opacity 0.15s, transform 0.15s, box-shadow 0.15s, border-color 0.15s, background 0.15s',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    ...palettes[variant],
    ...style,
  };

  return (
    <button ref={ref} disabled={isDisabled} style={baseStyle} {...rest}>
      {loading ? (
        <Spinner size={size === 'sm' ? 12 : size === 'lg' ? 18 : 14} />
      ) : (
        iconLeft && <span style={{ display: 'inline-flex' }}>{iconLeft}</span>
      )}
      {children}
      {!loading && iconRight && <span style={{ display: 'inline-flex' }}>{iconRight}</span>}
    </button>
  );
});
