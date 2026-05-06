import { type CSSProperties, type ReactNode } from 'react';
import { FONT } from '../../theme/tokens';

export interface SectionLabelProps {
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Uppercase, tracked-out label used as a section heading.
 * Replaces the various ad-hoc caps labels scattered across the codebase.
 */
export function SectionLabel({ children, style }: SectionLabelProps) {
  const baseStyle: CSSProperties = {
    fontSize: FONT.size.xs,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: FONT.weight.medium,
    opacity: 0.45,
    ...style,
  };

  return <div style={baseStyle}>{children}</div>;
}
