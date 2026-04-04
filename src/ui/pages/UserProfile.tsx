import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getProfileByUsername, upsertProfile } from '../../lib/profiles';
import { getUserPublicSketches } from '../../lib/profiles';
import type { Profile, Sketch } from '../../lib/supabase';

export function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
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

  if (loading) {
    return <div style={styles.container}><div style={styles.center}>loading...</div></div>;
  }

  if (notFound || !profile) {
    return (
      <div style={styles.container}>
        <div style={styles.center}>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>User not found</div>
          <Link to="/explore" style={{ fontSize: '16px', color: '#0a0a0a', opacity: 0.5 }}>
            Browse public sketches
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <Link to="/" style={{ textDecoration: 'none', color: '#0a0a0a', fontSize: '22px', fontWeight: 700, letterSpacing: '0.06em' }}>
          satie
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link to="/explore" style={{ fontSize: '15px', color: '#0a0a0a', opacity: 0.35, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#0a0a0a" stroke="none" />
            </svg>
            explore
          </Link>
          {user && (
            <Link to="/sketches" style={{ fontSize: '15px', color: '#0a0a0a', opacity: 0.35, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              sketches
            </Link>
          )}
        </div>
      </header>

      <div style={styles.content}>
        {/* Profile header */}
        <div style={styles.profileHeader}>
          {/* Avatar */}
          <div style={styles.avatar}>
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.username}
                style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              (profile.username[0] || '?').toUpperCase()
            )}
          </div>

          <div style={{ flex: 1 }}>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Display name"
                  style={styles.editInput}
                />
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Bio"
                  rows={2}
                  style={{ ...styles.editInput, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleSaveProfile} style={styles.saveBtn}>Save</button>
                  <button onClick={() => setEditing(false)} style={styles.cancelBtn}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>
                  {profile.display_name || profile.username}
                </div>
                <div style={{ fontSize: '16px', opacity: 0.35, marginTop: '2px' }}>
                  @{profile.username}
                </div>
                {profile.bio && (
                  <div style={{ fontSize: '15px', opacity: 0.6, marginTop: '8px', lineHeight: '1.5' }}>
                    {profile.bio}
                  </div>
                )}
                <div style={{ fontSize: '16px', opacity: 0.25, marginTop: '8px' }}>
                  Joined {formatDate(profile.created_at)}
                  {' · '}
                  {sketches.length} public sketch{sketches.length !== 1 ? 'es' : ''}
                </div>
                {isOwner && (
                  <button onClick={startEditing} style={styles.editBtn}>
                    Edit profile
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sketches */}
        <div style={{ marginTop: '32px' }}>
          <div style={styles.sectionTitle}>Public Sketches</div>

          {sketches.length === 0 && (
            <div style={{ fontSize: '15px', opacity: 0.3, marginTop: '16px' }}>
              No public sketches yet.
            </div>
          )}

          <div style={styles.grid}>
            {sketches.map((sketch) => (
              <div
                key={sketch.id}
                onClick={() => navigate(`/s/${sketch.id}`)}
                style={styles.card}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#1a3a2a';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#d0cdc4';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
                  {sketch.title}
                </div>
                <pre style={styles.preview}>
                  {sketch.script.slice(0, 80)}{sketch.script.length > 80 ? '...' : ''}
                </pre>
                <div style={styles.meta}>
                  <span>{new Date(sketch.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {(sketch.like_count ?? 0) > 0 && <span>{sketch.like_count} likes</span>}
                  {(sketch.fork_count ?? 0) > 0 && <span>{sketch.fork_count} forks</span>}
                  {sketch.forked_from && <span style={{ fontStyle: 'italic' }}>forked</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    minHeight: '100vh',
    background: '#f4f3ee',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#0a0a0a',
  },
  center: {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)', textAlign: 'center',
    fontSize: '16px', opacity: 0.4,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 32px', borderBottom: '1px solid #d0cdc4',
  },
  content: { maxWidth: 800, margin: '0 auto', padding: '32px' },
  profileHeader: { display: 'flex', gap: '20px', alignItems: 'flex-start' },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    background: '#1a3a2a', color: '#faf9f6',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '24px', fontWeight: 700, flexShrink: 0, overflow: 'hidden',
  },
  editBtn: {
    marginTop: '8px', padding: '4px 12px', background: 'none',
    border: '1px solid #d0cdc4', borderRadius: 6, cursor: 'pointer',
    fontSize: '15px', fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a', opacity: 0.5,
  },
  editInput: {
    padding: '6px 10px', border: '1px solid #d0cdc4', borderRadius: 6,
    fontSize: '15px', fontFamily: "'Inter', system-ui, sans-serif",
    background: 'transparent', color: '#0a0a0a', outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  },
  saveBtn: {
    padding: '5px 14px', background: '#0a0a0a', color: '#faf9f6',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: '16px', fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600,
  },
  cancelBtn: {
    padding: '5px 14px', background: 'none', color: '#0a0a0a',
    border: '1px solid #d0cdc4', borderRadius: 6, cursor: 'pointer',
    fontSize: '16px', fontFamily: "'Inter', system-ui, sans-serif",
  },
  sectionTitle: {
    fontSize: '16px', fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', opacity: 0.35,
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '14px', marginTop: '14px',
  },
  card: {
    background: '#faf9f6', border: '1.5px solid #d0cdc4', borderRadius: 14,
    padding: '16px', cursor: 'pointer',
    transition: 'border-color 0.15s, transform 0.15s',
  },
  preview: {
    fontSize: '16px', fontFamily: "'SF Mono', monospace", opacity: 0.3,
    whiteSpace: 'pre-wrap' as const, overflow: 'hidden', maxHeight: 36,
    margin: '0 0 10px',
  },
  meta: {
    display: 'flex', gap: '10px', fontSize: '15px', opacity: 0.25,
  },
};
