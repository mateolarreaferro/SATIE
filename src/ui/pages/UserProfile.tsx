import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getProfileByUsername, upsertProfile } from '../../lib/profiles';
import { getUserPublicSketches } from '../../lib/profiles';
import { useTheme } from '../theme/ThemeContext';
import { Header } from '../components/Header';
import { Button, Card, SectionLabel, Spinner, EmptyState } from '../components/primitives';
import { RADIUS, FONT } from '../theme/tokens';
import type { Profile, Sketch } from '../../lib/supabase';

/** Deterministic gradient avatar from a username. */
function avatarGradient(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 60) % 360;
  return `linear-gradient(135deg, hsl(${a},65%,55%), hsl(${b},65%,45%))`;
}

export function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme, mode, setMode } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');

  const isOwner = user && profile && user.id === profile.id;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    getProfileByUsername(username)
      .then(async (p) => {
        if (p) {
          setProfile(p);
          document.title = `${p.display_name || p.username} — Satie`;
          const s = await getUserPublicSketches(p.id);
          setSketches(s);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [username]);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;
    try {
      const updated = await upsertProfile(profile.id, {
        display_name: editDisplayName.trim() || null,
        bio: editBio.trim() || null,
      });
      setProfile(updated);
      setEditing(false);
    } catch (e) {
      console.error('Failed to update profile:', e);
    }
  }, [profile, editDisplayName, editBio]);

  const startEditing = useCallback(() => {
    if (!profile) return;
    setEditDisplayName(profile.display_name || '');
    setEditBio(profile.bio || '');
    setEditing(true);
  }, [profile]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const containerStyle: React.CSSProperties = {
    width: '100vw',
    minHeight: '100vh',
    background: theme.bg,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: theme.text,
  };

  if (loading) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={32} />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          title="User not found"
          description="That username doesn't match any Satie profile."
          action={<Button variant="primary" onClick={() => navigate('/explore')}>Browse public sketches</Button>}
        />
      </div>
    );
  }

  const editInputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: RADIUS.sm,
    fontSize: FONT.size.md,
    fontFamily: "'Inter', system-ui, sans-serif",
    background: theme.cardBg,
    color: theme.text,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={containerStyle}>
      <Header theme={theme} mode={mode} setMode={setMode} />

      <div style={{ maxWidth: 800, margin: '0 auto', padding: 32 }}>
        {/* Profile header */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            background: profile.avatar_url ? theme.cardBg : avatarGradient(profile.username),
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            fontWeight: 700,
            flexShrink: 0,
            overflow: 'hidden',
            textShadow: '0 0 6px rgba(0,0,0,0.35)',
          }}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (profile.username[0] || '?').toUpperCase()
            )}
          </div>

          <div style={{ flex: 1 }}>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Display name"
                  aria-label="Display name"
                  style={editInputStyle}
                />
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Bio"
                  aria-label="Bio"
                  rows={2}
                  style={{ ...editInputStyle, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" size="sm" onClick={handleSaveProfile}>Save</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: FONT.size.xl, fontWeight: FONT.weight.semibold }}>
                  {profile.display_name || profile.username}
                </div>
                <div style={{ fontSize: FONT.size.md, opacity: 0.55, marginTop: 2 }}>
                  @{profile.username}
                </div>
                {profile.bio && (
                  <div style={{ fontSize: FONT.size.md, opacity: 0.7, marginTop: 8, lineHeight: 1.5 }}>
                    {profile.bio}
                  </div>
                )}
                <div style={{ fontSize: FONT.size.body, opacity: 0.45, marginTop: 8 }}>
                  Joined {formatDate(profile.created_at)}
                  {' · '}
                  {sketches.length} public sketch{sketches.length !== 1 ? 'es' : ''}
                </div>
                {isOwner && (
                  <div style={{ marginTop: 10 }}>
                    <Button variant="ghost" size="sm" onClick={startEditing}>Edit profile</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sketches */}
        <div style={{ marginTop: 36 }}>
          <SectionLabel>Public Sketches</SectionLabel>

          {sketches.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <EmptyState
                title="No public sketches yet"
                description="Sketches the user marks public will appear here."
              />
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
              marginTop: 14,
            }}>
              {sketches.map((sketch) => (
                <Card
                  key={sketch.id}
                  interactive
                  padding={16}
                  onClick={() => navigate(`/s/${sketch.id}`)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = theme.accent;
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = theme.cardBorder;
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ fontSize: FONT.size.md, fontWeight: FONT.weight.semibold, marginBottom: 6 }}>
                    {sketch.title}
                  </div>
                  <pre style={{
                    fontSize: FONT.size.body,
                    fontFamily: "'SF Mono', monospace",
                    opacity: 0.45,
                    whiteSpace: 'pre-wrap',
                    overflow: 'hidden',
                    maxHeight: 36,
                    margin: '0 0 10px',
                    color: theme.text,
                  }}>
                    {sketch.script.slice(0, 80)}{sketch.script.length > 80 ? '…' : ''}
                  </pre>
                  <div style={{
                    display: 'flex',
                    gap: 10,
                    fontSize: FONT.size.body,
                    opacity: 0.45,
                    color: theme.text,
                  }}>
                    <span>{new Date(sketch.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    {(sketch.like_count ?? 0) > 0 && <span>{sketch.like_count} likes</span>}
                    {(sketch.fork_count ?? 0) > 0 && <span>{sketch.fork_count} forks</span>}
                    {sketch.forked_from && <span style={{ fontStyle: 'italic' }}>forked</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
