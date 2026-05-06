import { type CSSProperties, type ReactNode } from 'react';
import { useTheme } from '../../theme/ThemeContext';
import { FONT } from '../../theme/tokens';

export interface EmptyStateProps {
  /** Optional icon (SVG element, never an emoji). */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Optional action button or link rendered below the description. */
  action?: ReactNode;
  style?: CSSProperties;
}

/**
 * Standard empty-state layout. Replaces bare text like "no items" / "loading…"
 * scattered across the codebase. Consumers always pass an SVG for the icon —
 * the project rule forbids emojis in the UI.
 */
export function EmptyState({ icon, title, description, action, style }: EmptyStateProps) {
  const { theme } = useTheme();

  const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 32,
    gap: 8,
    color: theme.text,
    ...style,
  };

  const iconStyle: CSSProperties = {
    color: theme.textMuted,
    marginBottom: 4,
    display: 'inline-flex',
  };

  const titleStyle: CSSProperties = {
    fontSize: FONT.size.md,
    fontWeight: FONT.weight.semibold,
    color: theme.text,
  };

  const descStyle: CSSProperties = {
    fontSize: FONT.size.sm,
    color: theme.textMuted,
    maxWidth: 360,
    lineHeight: 1.5,
  };

  const actionStyle: CSSProperties = {
    marginTop: 12,
  };

  return (
    <div style={wrapStyle}>
      {icon && <span style={iconStyle}>{icon}</span>}
      <div style={titleStyle}>{title}</div>
      {description && <div style={descStyle}>{description}</div>}
      {action && <div style={actionStyle}>{action}</div>}
    </div>
  );
}
