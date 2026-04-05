/**
 * Community Sample Library page — browse, search, preview, and download shared audio samples.
 * Route: /library
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useDayNightCycle } from '../hooks/useDayNightCycle';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';
import { useSFX } from '../hooks/useSFX';
import { useSamplePreview } from '../hooks/useSamplePreview';
import { useAuth } from '../../lib/AuthContext';
import { RiverCanvas } from '../components/RiverCanvas';
import { Header } from '../components/Header';
import { CommunityUploadDialog } from '../components/CommunityUploadDialog';
import {
  getPopularSamples,
  getRecentSamples,
  searchByTags,
  searchByText,
  getPopularTags,
  downloadCommunitySample,
  type CommunitySample,
} from '../../lib/communitySamples';

type SortMode = 'popular' | 'recent';

/** Shared AudioContext for decoding dropped files */
let _decodeCtx: AudioContext | null = null;
function getDecodeCtx(): AudioContext {
  if (!_decodeCtx || _decodeCtx.state === 'closed') _decodeCtx = new AudioContext();
  return _decodeCtx;
}

const ACCEPTED_AUDIO = /\.(wav|mp3|ogg|flac|m4a|webm)$/i;

export function Library() {
  const { theme, mode, setMode } = useDayNightCycle();
  useBackgroundMusic('/Satie-Theme.wav', 0.08);
  const sfx = useSFX();
  const preview = useSamplePreview();
  const { user } = useAuth();

  const [samples, setSamples] = useState<CommunitySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('popular');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [popularTags, setPopularTags] = useState<{ tag: string; count: number }[]>([]);
  const [selectedSample, setSelectedSample] = useState<CommunitySample | null>(null);
  const [previewBuffers, setPreviewBuffers] = useState<Map<string, ArrayBuffer>>(new Map());
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Drag-and-drop upload state
  const [dragOver, setDragOver] = useState(false);
  const [uploadFile, setUploadFile] = useState<{ buffer: AudioBuffer; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load initial data
  useEffect(() => {
    Promise.all([
      getPopularSamples(100),
      getPopularTags(20),
    ]).then(([s, t]) => {
      setSamples(s);
      setPopularTags(t);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Search with debounce
  const doSearch = useCallback(async (query: string, tags: string[], sortMode: SortMode) => {
    setLoading(true);
    try {
      let results: CommunitySample[];
      if (query.trim()) {
        results = await searchByText(query, 50);
      } else if (tags.length > 0) {
        results = await searchByTags(tags, 50);
      } else {
        results = sortMode === 'popular'
          ? await getPopularSamples(100)
          : await getRecentSamples(100);
      }
      setSamples(results);
    } catch (e) {
      console.error('[Library] Search failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(value, activeTags, sort), 400);
  }, [activeTags, sort, doSearch]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags(prev => {
      const next = prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag];
      doSearch(searchQuery, next, sort);
      return next;
    });
  }, [searchQuery, sort, doSearch]);

  const handleSortChange = useCallback((s: SortMode) => {
    setSort(s);
    doSearch(searchQuery, activeTags, s);
  }, [searchQuery, activeTags, doSearch]);

  const handlePreview = useCallback(async (sample: CommunitySample) => {
    sfx.click();
    let buffer = previewBuffers.get(sample.id);
    if (!buffer) {
      buffer = await downloadCommunitySample(sample);
      setPreviewBuffers(prev => new Map(prev).set(sample.id, buffer!));
    }
    preview.play(sample.id, buffer);
  }, [preview, previewBuffers, sfx]);

  const formatDuration = (ms: number) => {
    const s = ms / 1000;
    return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  // Process dropped or selected audio files
  const processAudioFile = useCallback(async (file: File) => {
    if (!ACCEPTED_AUDIO.test(file.name)) return;
    if (!user) return; // require auth
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = getDecodeCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const nameWithoutExt = file.name.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ');
      setUploadFile({ buffer: audioBuffer, name: nameWithoutExt });
    } catch (e) {
      console.error('[Library] Failed to decode audio file:', e);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processAudioFile(files[0]);
  }, [processAudioFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processAudioFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processAudioFile]);

  const handleUploadComplete = useCallback(() => {
    setUploadFile(null);
    // Refresh the list
    doSearch(searchQuery, activeTags, sort);
  }, [doSearch, searchQuery, activeTags, sort]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: theme.bg,
      transition: 'background 1.5s ease, color 1.5s ease',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: theme.text,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <RiverCanvas mode={mode} />
      <Header theme={theme} mode={mode} setMode={setMode} />

      {/* Hidden file input for click-to-upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.ogg,.flac,.m4a,.webm"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '24px 32px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Title + search bar */}
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            margin: '0 0 6px',
            letterSpacing: '0.02em',
          }}>
            community library
          </h1>
          <p style={{ fontSize: 14, opacity: 0.4, margin: '0 0 20px' }}>
            Shared audio samples from the Satie community. All CC0 public domain.
          </p>

          {/* Search */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search samples..."
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 12,
                border: `1px solid ${theme.border}`,
                background: `${theme.cardBg}88`,
                backdropFilter: 'blur(8px)',
                fontSize: 14,
                fontFamily: "'Inter', sans-serif",
                color: theme.text,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 2 }}>
              {(['popular', 'recent'] as SortMode[]).map(s => (
                <button
                  key={s}
                  onClick={() => { sfx.click(); handleSortChange(s); }}
                  onMouseEnter={sfx.hover}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: `1px solid ${theme.border}`,
                    background: sort === s ? theme.invertedBg : 'transparent',
                    color: sort === s ? theme.invertedText : theme.text,
                    fontSize: 13,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: sort === s ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Tag filters */}
          {popularTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {popularTags.map(({ tag, count }) => {
                const isActive = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => { sfx.click(); toggleTag(tag); }}
                    onMouseEnter={sfx.hover}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 12,
                      border: `1px solid ${isActive ? theme.text : theme.border}`,
                      background: isActive ? theme.invertedBg : 'transparent',
                      color: isActive ? theme.invertedText : theme.text,
                      fontSize: 12,
                      fontFamily: "'Inter', sans-serif",
                      cursor: 'pointer',
                      opacity: isActive ? 1 : 0.6,
                      transition: 'all 0.2s',
                    }}
                  >
                    {tag} <span style={{ opacity: 0.5 }}>({count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, opacity: 0.4, fontSize: 15 }}>
              loading...
            </div>
          )}

          {/* Empty state */}
          {!loading && samples.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, opacity: 0.4, fontSize: 15 }}>
              {searchQuery || activeTags.length > 0
                ? 'No samples match your search. Try different keywords or tags.'
                : 'No community samples yet. Be the first to share one!'}
            </div>
          )}

          {/* Drop zone — centered, above the grid */}
          {user && (
            <DropZoneCard
              dragOver={dragOver}
              theme={theme}
              sfx={sfx}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => { sfx.click(); fileInputRef.current?.click(); }}
            />
          )}

          {/* Sample grid */}
          {!loading && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}>
              {samples.map(sample => (
                <SampleCard
                  key={sample.id}
                  sample={sample}
                  theme={theme}
                  sfx={sfx}
                  isSelected={selectedSample?.id === sample.id}
                  isPlaying={preview.playingId === sample.id}
                  onSelect={() => {
                    sfx.click();
                    setSelectedSample(selectedSample?.id === sample.id ? null : sample);
                  }}
                  onPreview={() => handlePreview(sample)}
                  formatDuration={formatDuration}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel (slide-up when sample selected) */}
      {selectedSample && (
        <SampleDetailPanel
          sample={selectedSample}
          theme={theme}
          isPlaying={preview.playingId === selectedSample.id}
          onClose={() => setSelectedSample(null)}
          onPreview={() => handlePreview(selectedSample)}
          formatDuration={formatDuration}
        />
      )}

      {/* Upload dialog */}
      {uploadFile && user && (
        <CommunityUploadDialog
          audioBuffer={uploadFile.buffer}
          fileName={uploadFile.name}
          userId={user.id}
          onClose={() => setUploadFile(null)}
          onUploaded={handleUploadComplete}
        />
      )}
    </div>
  );
}

// ── Drop zone card ──

function DropZoneCard({ dragOver, theme, sfx, onDragOver, onDragLeave, onDrop, onClick }: {
  dragOver: boolean;
  theme: ReturnType<typeof useDayNightCycle>['theme'];
  sfx: ReturnType<typeof useSFX>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onMouseEnter={sfx.hover}
      style={{
        padding: '18px 24px',
        borderRadius: 14,
        border: `2px dashed ${dragOver ? theme.text : theme.border}`,
        background: dragOver ? `${theme.text}08` : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        marginBottom: 16,
        opacity: dragOver ? 1 : 0.45,
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={theme.text}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>
        {dragOver ? 'drop here' : 'drag audio to share'}
      </span>
      <span style={{ fontSize: 12, color: theme.text, opacity: 0.5 }}>
        or click to browse
      </span>
    </div>
  );
}

// ── Sample card component ──

function SampleCard({ sample, theme, sfx, isSelected, isPlaying, onSelect, onPreview, formatDuration }: {
  sample: CommunitySample;
  theme: ReturnType<typeof useDayNightCycle>['theme'];
  sfx: ReturnType<typeof useSFX>;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onPreview: () => void;
  formatDuration: (ms: number) => string;
}) {
  return (
    <div
      onClick={onSelect}
      onMouseEnter={sfx.hover}
      style={{
        padding: 16,
        borderRadius: 14,
        border: `1.5px solid ${isSelected ? theme.text : theme.border}`,
        background: `${theme.cardBg}88`,
        backdropFilter: 'blur(8px)',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {/* Waveform + play button row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Play/Stop icon */}
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          style={{
            width: 30, height: 30,
            borderRadius: 15,
            border: 'none',
            background: isPlaying ? theme.text : `${theme.text}15`,
            color: isPlaying ? theme.cardBg : theme.text,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          {isPlaying ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="8" height="8" rx="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="2,0 10,5 2,10" />
            </svg>
          )}
        </button>

        {/* Mini waveform */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sample.waveform_peaks && (
            <MiniWaveform peaks={sample.waveform_peaks} color={theme.text} />
          )}
        </div>
      </div>

      {/* Name */}
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        marginTop: 8,
        marginBottom: 4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {sample.name}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {sample.tags.slice(0, 4).map(tag => (
          <span key={tag} style={{
            padding: '2px 8px',
            borderRadius: 8,
            background: `${theme.text}10`,
            fontSize: 11,
            opacity: 0.6,
          }}>
            {tag}
          </span>
        ))}
        {sample.tags.length > 4 && (
          <span style={{ fontSize: 11, opacity: 0.4 }}>+{sample.tags.length - 4}</span>
        )}
      </div>

      {/* Meta */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 12,
        opacity: 0.35,
      }}>
        <span>{formatDuration(sample.duration_ms)}</span>
        <span>{sample.download_count} downloads</span>
      </div>
    </div>
  );
}

// ── Mini waveform ──

function MiniWaveform({ peaks, color }: { peaks: number[]; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const barWidth = w / peaks.length;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * h * 0.9;
      const x = i * barWidth;
      const y = (h - barHeight) / 2;
      ctx.fillRect(x, y, Math.max(barWidth - 0.5, 0.5), barHeight || 0.5);
    }
  }, [peaks, color]);

  return (
    <canvas
      ref={canvasRef}
      width={260}
      height={32}
      style={{ width: '100%', height: 32, borderRadius: 6 }}
    />
  );
}

// ── Detail panel ──

function SampleDetailPanel({ sample, theme, isPlaying, onClose, onPreview, formatDuration }: {
  sample: CommunitySample;
  theme: ReturnType<typeof useDayNightCycle>['theme'];
  isPlaying: boolean;
  onClose: () => void;
  onPreview: () => void;
  formatDuration: (ms: number) => string;
}) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      background: `${theme.cardBg}ee`,
      backdropFilter: 'blur(16px)',
      borderTop: `1px solid ${theme.border}`,
      padding: '20px 32px',
      zIndex: 5,
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 24, alignItems: 'center' }}>
        {/* Play/Stop */}
        <button
          onClick={onPreview}
          style={{
            width: 40, height: 40,
            borderRadius: 20,
            border: 'none',
            background: isPlaying ? theme.text : `${theme.text}15`,
            color: isPlaying ? theme.cardBg : theme.text,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <polygon points="3,0 14,7 3,14" />
            </svg>
          )}
        </button>

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{sample.name}</div>
          {sample.description && (
            <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8 }}>{sample.description}</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {sample.tags.map(tag => (
              <span key={tag} style={{
                padding: '3px 10px',
                borderRadius: 10,
                background: `${theme.text}12`,
                fontSize: 12,
              }}>
                {tag}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.35 }}>
            {formatDuration(sample.duration_ms)} &middot; {(sample.size_bytes / 1024).toFixed(0)}KB
            &middot; {sample.download_count} downloads
          </div>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: 'transparent',
            color: theme.text,
            fontSize: 18,
            cursor: 'pointer',
            opacity: 0.4,
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
