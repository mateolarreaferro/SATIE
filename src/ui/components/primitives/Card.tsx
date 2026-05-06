import {
  forwardRef,
  type HTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { RADIUS, SHADOW } from '../../theme/tokens';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Inner padding in px. Defaults to 16. Pass 0 to opt out. */
  padding?: number;
  /** Adds hover lift + cursor pointer. */
  interactive?: boolean;
  children?: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 16, interactive = false, style, children, ...rest },
  ref,
) {
  const { theme } = useTheme();

  const baseStyle: CSSProperties = {
    background: theme.cardBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: RADIUS.lg,
    padding,
    color: theme.text,
    boxShadow: interactive ? SHADOW.sm : undefined,
    cursor: interactive ? 'pointer' : undefined,
    transition: interactive ? 'box-shadow 0.2s, border-color 0.2s, transform 0.15s' : undefined,
    ...style,
  };

  return (
    <div ref={ref} style={baseStyle} {...rest}>
      {children}
    </div>
  );
});
