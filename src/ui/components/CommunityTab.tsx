/**
 * Community tab for the AssetPanel — browse and add community samples to a sketch.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getPopularSamples,
  searchByText,
  downloadCommunitySample,
  type CommunitySample,
} from '../../lib/communitySamples';
import { useSamplePreview } from '../hooks/useSamplePreview';
import { useAuth } from '../../lib/AuthContext';
import { CommunityUploadDialog } from './CommunityUploadDialog';

const ACCEPTED_AUDIO = /\.(wav|mp3|ogg|flac|m4a|webm)$/i;

/** Shared AudioContext for decoding dropped files */
let _decodeCtx: AudioContext | null = null;
function getDecodeCtx(): AudioContext {
  if (!_decodeCtx || _decodeCtx.state === 'closed') _decodeCtx = new AudioContext();
  return _decodeCtx;
}

interface CommunityTabProps {
  onLoadBuffer: (name: string, data: ArrayBuffer, category?: 'imported') => Promise<void>;
}

export function CommunityTab({ onLoadBuffer }: CommunityTabProps) {
  const { user } = useAuth();
  const [samples, setSamples] = useState<CommunitySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadFile, setUploadFile] = useState<{ buffer: AudioBuffer; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const preview = useSamplePreview();
  const [previewBuffers, setPreviewBuffers] = useState<Map<string, ArrayBuffer>>(new Map());

  useEffect(() => {
    getPopularSamples(30)
      .then(setSamples)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearch(query);
    if (!query.trim()) {
      setLoading(true);
      getPopularSamples(30)
        .then(setSamples)
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    searchByText(query, 20)
      .then(setSamples)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePreview = useCallback(async (sample: CommunitySample) => {
    let buffer = previewBuffers.get(sample.id);
    if (!buffer) {
      buffer = await downloadCommunitySample(sample);
      setPreviewBuffers(prev => new Map(prev).set(sample.id, buffer!));
    }
    preview.play(sample.id, buffer);
  }, [preview, previewBuffers]);

  // Drag-and-drop / file upload for sharing
  const processAudioFile = useCallback(async (file: File) => {
    if (!ACCEPTED_AUDIO.test(file.name) || !user) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = getDecodeCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const nameWithoutExt = file.name.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ');
      setUploadFile({ buffer: audioBuffer, name: nameWithoutExt });
    } catch (e) {
      console.error('[CommunityTab] Failed to decode audio:', e);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processAudioFile(file);
  }, [processAudioFile]);

  const handleUploadComplete = useCallback(() => {
    setUploadFile(null);
    // Refresh list
    setLoading(true);
    getPopularSamples(30).then(setSamples).finally(() => setLoading(false));
  }, []);

  const handleAdd = useCallback(async (sample: CommunitySample) => {
    setAdding(sample.id);
    try {
      let buffer = previewBuffers.get(sample.id);
      if (!buffer) {
        buffer = await downloadCommunitySample(sample);
        setPreviewBuffers(prev => new Map(prev).set(sample.id, buffer!));
      }
      await onLoadBuffer(`community/${sample.name}`, buffer, 'imported');
    } catch (e) {
      console.error('[CommunityTab] Failed to add sample:', e);
    } finally {
      setAdding(null);
    }
  }, [onLoadBuffer, previewBuffers]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Search */}
      <input
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search community..."
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #d0cdc4',
          fontSize: 13,
          fontFamily: "'Inter', sans-serif",
          outline: 'none',
          background: 'transparent',
          color: '#1a3a2a',
        }}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.ogg,.flac,.m4a,.webm"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processAudioFile(file);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      {/* Drop zone */}
      {user && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 0',
            borderRadius: 8,
            border: `1.5px dashed ${dragOver ? '#1a3a2a' : '#d0cdc4'}`,
            background: dragOver ? 'rgba(26,58,42,0.04)' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
            flexShrink: 0,
            opacity: dragOver ? 1 : 0.5,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a3a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: 12, color: '#1a3a2a', fontWeight: 500 }}>
            {dragOver ? 'drop here' : 'share a sample'}
          </span>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 12, opacity: 0.4, fontSize: 13, textAlign: 'center' }}>
            loading...
          </div>
        )}

        {!loading && samples.length === 0 && (
          <div style={{ padding: 12, opacity: 0.4, fontSize: 13, textAlign: 'center' }}>
            {search ? 'No results' : 'No community samples yet'}
          </div>
        )}

        {!loading && samples.map(sample => (
          <div
            key={sample.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 4px',
              borderBottom: '1px solid #e8e7e2',
              fontSize: 13,
            }}
          >
            {/* Play button */}
            <button
              onClick={() => handlePreview(sample)}
              style={{
                width: 24, height: 24,
                borderRadius: 12,
                border: '1px solid #d0cdc4',
                background: 'none',
                cursor: 'pointer',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#1a3a2a',
              }}
              title="Preview"
            >
              &#9654;
            </button>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {sample.name}
              </div>
              <div style={{ fontSize: 11, opacity: 0.4 }}>
                {sample.tags.slice(0, 3).join(', ')}
              </div>
            </div>

            {/* Add button */}
            <button
              onClick={() => handleAdd(sample)}
              disabled={adding === sample.id}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid #1a3a2a',
                background: adding === sample.id ? '#1a3a2a' : 'none',
                color: adding === sample.id ? '#fff' : '#1a3a2a',
                fontSize: 11,
                cursor: adding === sample.id ? 'wait' : 'pointer',
                fontFamily: "'Inter', sans-serif",
                flexShrink: 0,
              }}
            >
              {adding === sample.id ? '...' : '+ add'}
            </button>
          </div>
        ))}
      </div>

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
