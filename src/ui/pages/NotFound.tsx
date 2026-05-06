import { Link } from 'react-router-dom';
import { useTheme } from '../theme/ThemeContext';
import { Button } from '../components/primitives';
import { FONT } from '../theme/tokens';

export function NotFound() {
  const { theme } = useTheme();

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      background: theme.bg,
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        fontSize: 72,
        fontWeight: FONT.weight.bold,
        letterSpacing: '-0.04em',
        opacity: 0.15,
        lineHeight: 1,
        marginBottom: 8,
      }}>
        404
      </div>
      <h1 style={{
        fontSize: FONT.size.hero,
        fontWeight: FONT.weight.semibold,
        margin: '0 0 8px',
        textAlign: 'center',
      }}>
        Page not found
      </h1>
      <p style={{
        fontSize: FONT.size.md,
        opacity: 0.6,
        maxWidth: 380,
        textAlign: 'center',
        lineHeight: 1.5,
        margin: '0 0 24px',
      }}>
        That URL doesn't lead anywhere. The sketch may be private, or you might
        have a typo.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Button variant="primary">Go home</Button>
        </Link>
        <Link to="/explore" style={{ textDecoration: 'none' }}>
          <Button variant="ghost">Browse sketches</Button>
        </Link>
      </div>
    </div>
  );
}
