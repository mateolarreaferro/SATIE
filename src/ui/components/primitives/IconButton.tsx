import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { RADIUS } from '../../theme/tokens';

export type IconButtonVariant = 'ghost' | 'solid' | 'inverted' | 'overlay';

export type IconButtonSize = 24 | 32 | 40;

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: spoken label for screen readers. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 32, style, disabled, children, ...rest },
  ref,
) {
  const { theme } = useTheme();

  const palettes: Record<IconButtonVariant, CSSProperties> = {
    ghost: {
      background: 'transparent',
      color: theme.text,
      border: '1px solid transparent',
    },
    solid: {
      background: theme.cardBg,
      color: theme.text,
      border: `1px solid ${theme.cardBorder}`,
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
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: RADIUS.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'opacity 0.15s, transform 0.15s, background 0.15s, border-color 0.15s',
    flexShrink: 0,
    ...palettes[variant],
    ...style,
  };

  return (
    <button ref={ref} disabled={disabled} style={baseStyle} {...rest}>
      {children}
    </button>
  );
});
