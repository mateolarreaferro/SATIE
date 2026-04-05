/**
 * Modal dialog for uploading audio samples to the community library.
 * Interactive waveform with play/stop and scrubbing, AI-suggested tags.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { analyzeAudioBuffer } from '../../lib/audioAnalysis';
import { suggestTags, computeEmbedding } from '../../lib/communityTagging';
import { uploadCommunitySample } from '../../lib/communitySamples';
import type { AudioFeatures } from '../../lib/audioAnalysis';

interface CommunityUploadDialogProps {
  audioBuffer: AudioBuffer;
  fileName: string;
  userId: string;
  onClose: () => void;
  onUploaded: () => void;
  queueRemaining?: number;
}

// ── Shared preview AudioContext ──
let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') _ctx = new AudioContext();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function CommunityUploadDialog({
  audioBuffer,
  fileName,
  userId,
  onClose,
  onUploaded,
  queueRemaining = 0,
}: CommunityUploadDialogProps) {
  const [name, setName] = useState(
    fileName.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' '),
  );
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [phase, setPhase] = useState<'analyzing' | 'editing' | 'uploading' | 'done' | 'error'>('analyzing');
  const [error, setError] = useState('');
  const [aiTagsLoading, setAiTagsLoading] = useState(true);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0); // 0–1
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);

  // Waveform
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<number[]>([]);

  // Analyze audio on mount, then try AI tags separately
  useEffect(() => {
    let cancelled = false;

    const f = analyzeAudioBuffer(audioBuffer);
    if (cancelled) return;
    setFeatures(f);
    peaksRef.current = f.waveformPeaks;
    drawWaveform(f.waveformPeaks, 0);
    setPhase('editing');

    // AI tags — best effort, don't block the UI
    (async () => {
      try {
        const suggestion = await suggestTags(fileName, f);
        if (cancelled) return;
        if (suggestion.tags.length > 0) setTags(suggestion.tags);
        if (suggestion.description) setDescription(suggestion.description);
      } catch (err) {
        console.warn('[CommunityUpload] AI tagging unavailable:', err);
      } finally {
        if (!cancelled) setAiTagsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [audioBuffer, fileName]);

  // ── Waveform drawing ──

  const drawWaveform = useCallback((peaks: number[], progress: number, hoverPos?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const barWidth = w / peaks.length;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * h * 0.85;
      const x = i * barWidth * dpr;
      const y = (canvas.height - barHeight * dpr) / 2;
      const bw = Math.max(barWidth * dpr - 1, 1);
      const bh = barHeight * dpr || 1;

      const pos = i / peaks.length;
      if (pos < progress) {
        ctx.fillStyle = '#1a3a2a';
        ctx.globalAlpha = 0.9;
      } else if (hoverPos !== undefined && Math.abs(pos - hoverPos) < 1 / peaks.length * 3) {
        ctx.fillStyle = '#1a3a2a';
        ctx.globalAlpha = 0.5;
      } else {
        ctx.fillStyle = '#1a3a2a';
        ctx.globalAlpha = 0.2;
      }
      ctx.fillRect(x, y, bw, bh);
    }
    ctx.globalAlpha = 1;
  }, []);

  // Redraw on progress change
  useEffect(() => {
    if (peaksRef.current.length > 0) {
      drawWaveform(peaksRef.current, playProgress);
    }
  }, [playProgress, drawWaveform]);

  // ── Playback ──

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* ok */ }
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setPlayProgress(0);
    offsetRef.current = 0;
  }, []);

  const updateProgress = useCallback(() => {
    const ctx = getCtx();
    const elapsed = ctx.currentTime - startTimeRef.current + offsetRef.current;
    const duration = audioBuffer.duration;
    const p = Math.min(elapsed / duration, 1);
    setPlayProgress(p);
    if (p < 1 && sourceRef.current) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else if (p >= 1) {
      stopPlayback();
    }
  }, [audioBuffer, stopPlayback]);

  const startPlayback = useCallback((fromPos = 0) => {
    const ctx = getCtx();

    // Stop existing
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* ok */ }
    }
    cancelAnimationFrame(rafRef.current);

    const offset = fromPos * audioBuffer.duration;
    offsetRef.current = 0; // reset — we're tracking from ctx.currentTime

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        stopPlayback();
      }
    };
    source.start(0, offset);
    startTimeRef.current = ctx.currentTime - offset;
    offsetRef.current = 0;
    sourceRef.current = source;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(updateProgress);
  }, [audioBuffer, updateProgress, stopPlayback]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback(0);
    }
  }, [isPlaying, stopPlayback, startPlayback]);

  // Waveform click → seek
  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    startPlayback(pos);
  }, [startPlayback]);

  // Waveform hover
  const handleWaveformHover = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    drawWaveform(peaksRef.current, playProgress, pos);
  }, [playProgress, drawWaveform]);

  const handleWaveformLeave = useCallback(() => {
    drawWaveform(peaksRef.current, playProgress);
  }, [playProgress, drawWaveform]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  // ── Tags ──

  const addTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput('');
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  // ── Publish ──

  const handlePublish = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!features) {
      setError('Audio analysis not complete');
      return;
    }

    stopPlayback();
    setPhase('uploading');
    setError('');

    try {
      const wavData = audioBufferToWav(audioBuffer);
      const embedding = await computeEmbedding(name, description, tags);

      await uploadCommunitySample({
        userId,
        name: name.trim(),
        description: description.trim(),
        tags,
        data: wavData,
        durationMs: features.durationMs,
        waveformPeaks: features.waveformPeaks,
        embedding: embedding ?? undefined,
      });

      setPhase('done');
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('error');
    }
  }, [name, description, tags, features, audioBuffer, userId, onUploaded, stopPlayback]);

  // ── Canvas sizing ──

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    canvas.width = w * dpr;
    canvas.height = 80 * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = '80px';
    if (peaksRef.current.length > 0) {
      drawWaveform(peaksRef.current, playProgress);
    }
  }, [drawWaveform, playProgress]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#f4f3ee',
        borderRadius: 16,
        padding: 28,
        width: 480,
        maxWidth: '90vw',
        maxHeight: '85vh',
        overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontFamily: "'Inter', sans-serif", color: '#0a0a0a' }}>
              Share to Community
            </h2>
            {queueRemaining > 0 && (
              <span style={{
                fontSize: 12, color: '#888', fontFamily: "'Inter', sans-serif",
                padding: '2px 8px', background: '#e8e7e2', borderRadius: 8,
              }}>
                +{queueRemaining} more
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
              color: '#666', padding: '4px 8px', borderRadius: 6,
            }}
            title={queueRemaining > 0 ? 'Skip this file' : 'Close'}
          >
            {queueRemaining > 0 ? '→' : '×'}
          </button>
        </div>

        {/* Waveform + play controls */}
        <div ref={containerRef} style={{ marginBottom: 8 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#e8e7e2',
            borderRadius: 10,
            padding: '8px 12px',
          }}>
            {/* Play/Stop button */}
            <button
              onClick={togglePlayback}
              style={{
                width: 32, height: 32,
                borderRadius: 16,
                border: 'none',
                background: '#1a3a2a',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {isPlaying ? (
                // Stop icon
                <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
                  <rect x="1" y="1" width="10" height="10" rx="1" />
                </svg>
              ) : (
                // Play icon
                <svg width="12" height="12" viewBox="0 0 12 12" fill="white">
                  <polygon points="2,0 12,6 2,12" />
                </svg>
              )}
            </button>

            {/* Waveform canvas — clickable for seeking */}
            <canvas
              ref={canvasRef}
              onClick={handleWaveformClick}
              onMouseMove={handleWaveformHover}
              onMouseLeave={handleWaveformLeave}
              style={{
                flex: 1,
                height: 80,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            />
          </div>
        </div>

        {/* Time + duration */}
        {features && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: '#999',
            fontFamily: "'SF Mono', monospace",
            marginBottom: 16,
            padding: '0 4px',
          }}>
            <span>{formatTime(playProgress * audioBuffer.duration)}</span>
            <span>{formatTime(audioBuffer.duration)}</span>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{
            textAlign: 'center', padding: '20px 0', color: '#666',
            fontFamily: "'Inter', sans-serif", fontSize: 14,
          }}>
            Analyzing audio...
          </div>
        )}

        {(phase === 'editing' || phase === 'error') && (
          <>
            {/* Name */}
            <label style={labelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sample name"
              style={inputStyle}
            />

            {/* Description */}
            <label style={labelStyle}>
              Description
              {aiTagsLoading && <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 6 }}>generating...</span>}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this sound..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: "'Inter', sans-serif" }}
            />

            {/* Tags */}
            <label style={labelStyle}>
              Tags
              {aiTagsLoading && <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: 6 }}>generating...</span>}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, minHeight: 24 }}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 12,
                    background: '#1a3a2a', color: '#fff',
                    fontSize: 12, fontFamily: "'Inter', sans-serif",
                    cursor: 'pointer',
                    transition: 'opacity 0.15s',
                  }}
                  onClick={() => removeTag(tag)}
                  title="Click to remove"
                >
                  {tag} <span style={{ opacity: 0.6 }}>&times;</span>
                </span>
              ))}
              {tags.length === 0 && !aiTagsLoading && (
                <span style={{ fontSize: 12, opacity: 0.3, fontStyle: 'italic' }}>
                  No tags yet — add some below
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add a tag..."
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              />
              <button onClick={addTag} style={secondaryButtonStyle}>Add</button>
            </div>

            {/* License notice */}
            <div style={{
              fontSize: 11, color: '#888', marginBottom: 16, fontFamily: "'Inter', sans-serif",
              padding: '8px 12px', background: '#e8e7e2', borderRadius: 8,
            }}>
              By sharing, you agree this sample is released under CC0 (public domain).
              Anyone can use it freely, no attribution required.
            </div>

            {/* Error */}
            {error && (
              <div style={{
                color: '#8b0000', fontSize: 13, marginBottom: 12,
                fontFamily: "'Inter', sans-serif",
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
              <button
                onClick={handlePublish}
                style={{
                  ...primaryButtonStyle,
                  opacity: !name.trim() ? 0.5 : 1,
                  cursor: !name.trim() ? 'not-allowed' : 'pointer',
                }}
                disabled={!name.trim()}
              >
                Publish
              </button>
            </div>
          </>
        )}

        {phase === 'uploading' && (
          <div style={{
            textAlign: 'center', padding: '20px 0', color: '#666',
            fontFamily: "'Inter', sans-serif", fontSize: 14,
          }}>
            Uploading to community library...
          </div>
        )}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 16, color: '#1a3a2a', fontFamily: "'Inter', sans-serif", marginBottom: 12 }}>
              Sample shared successfully!
            </div>
            <button onClick={onClose} style={primaryButtonStyle}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#444',
  marginBottom: 4,
  fontFamily: "'Inter', sans-serif",
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #ccc',
  background: '#fff',
  fontSize: 14,
  fontFamily: "'Inter', sans-serif",
  color: '#0a0a0a',
  outline: 'none',
  marginBottom: 12,
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 10,
  border: 'none',
  background: '#1a3a2a',
  color: '#fff',
  fontSize: 14,
  fontFamily: "'Inter', sans-serif",
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 10,
  border: '1px solid #ccc',
  background: 'transparent',
  color: '#444',
  fontSize: 14,
  fontFamily: "'Inter', sans-serif",
  cursor: 'pointer',
};

// ── WAV encoder (minimal, for upload) ─────────────────────────

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  const length = channels[0].length;
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const dataSize = length * numChannels * (bitDepth / 8);
  const headerSize = 44;

  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
