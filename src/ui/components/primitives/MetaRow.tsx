import { Children, Fragment, type CSSProperties, type ReactNode } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { FONT } from '../../theme/tokens';

export interface MetaRowProps {
  children: ReactNode;
  /** Override the separator. Defaults to a middle dot. */
  separator?: ReactNode;
  style?: CSSProperties;
}

/**
 * A small horizontal flex row, children separated by a middle dot.
 * Standard layout for author · date · stats meta.
 */
export function MetaRow({ children, separator = '·', style }: MetaRowProps) {
  const { theme } = useTheme();
  const items = Children.toArray(children).filter(Boolean);

  const rowStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: theme.textMuted,
    fontSize: FONT.size.sm,
    ...style,
  };

  const sepStyle: CSSProperties = {
    opacity: 0.5,
    userSelect: 'none',
  };

  return (
    <div style={rowStyle}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <span style={sepStyle}>{separator}</span>}
          {child}
        </Fragment>
      ))}
    </div>
  );
}
