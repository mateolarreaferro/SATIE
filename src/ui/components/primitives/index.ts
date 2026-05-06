/**
 * Satie UI primitives.
 *
 * Foundation components built on the design tokens in `src/ui/theme/tokens.ts`.
 * All primitives:
 *   - read theme via `useTheme()` (from `src/ui/theme/ThemeContext`)
 *   - use inline styles only (project convention)
 *   - accept `style?: CSSProperties` for ad-hoc overrides
 *   - inherit a global `:focus-visible` ring from `interactions.css`
 *   - never include emoji glyphs (use SVG icons via `iconLeft` / `iconRight` / `icon`)
 */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Pill } from './Pill';
export type { PillProps, PillVariant, PillSize } from './Pill';

export { SectionLabel } from './SectionLabel';
export type { SectionLabelProps } from './SectionLabel';

export { MetaRow } from './MetaRow';
export type { MetaRowProps } from './MetaRow';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
