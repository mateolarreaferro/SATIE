import { type CSSProperties } from 'react';
import { useTheme } from '../../theme/ThemeContext';

export interface SpinnerProps {
  /** Diameter in px. Default 14. */
  size?: number;
  /** Override stroke color. Defaults to current theme text. */
  color?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/**
 * Small CSS-rotated SVG spinner. Replaces literal "loading…" text.
 * Animation keyframes (`satie-spin`) live in `interactions.css`.
 */
export function Spinner({ size = 14, color, style, 'aria-label': ariaLabel = 'Loading' }: SpinnerProps) {
  const { theme } = useTheme();
  const stroke = color ?? theme.text;
  const r = (size - 2) / 2;
  const cx = size / 2;

  const wrapStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'inline-block',
    flexShrink: 0,
    color: stroke,
    ...style,
  };

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className="satie-spin"
      style={wrapStyle}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cx} r={r} stroke="currentColor" strokeOpacity={0.2} strokeWidth={2} />
        <path
          d={`M ${cx} 1 a ${r} ${r} 0 0 1 ${r} ${r}`}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
