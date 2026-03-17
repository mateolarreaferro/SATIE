import { useState, useCallback, useRef } from 'react';
import { renderOffline, encodeWAV, downloadBlob, type RenderMode, type RenderProgress } from '../../engine/export';
import type { SatieEngine } from '../../engine';

interface ExportPanelProps {
  script: string;
  sampleBuffers: React.RefObject<Map<string, ArrayBuffer>>;
  engineRef: React.RefObject<SatieEngine | null>;
  isPlaying: boolean;
  currentTime: number;
}

type ExportFormat = 'stereo' | 'binaural' | 'ambisonic-foa' | 'video';

export function ExportPanel({ script, sampleBuffers, engineRef, isPlaying, currentTime }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>('stereo');
  const [duration, setDuration] = useState(30);
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState<16 | 24>(16);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleExportAudio = useCallback(async () => {
    if (format === 'video') return; // handled separately
    setExporting(true);
    setError(null);
    setProgress(null);

    try {
      const mode: RenderMode = format;
      // Pull decoded buffers from the live engine (includes gen audio)
      const engineBuffers = engineRef.current?.getAudioBuffers();

      const result = await renderOffline(
        {
          script,
          sampleBuffers: sampleBuffers.current ?? new Map(),
          decodedAudioBuffers: engineBuffers,
          duration,
          sampleRate,
          mode,
        },
        setProgress,
      );

      const blob = encodeWAV(result, bitDepth);

      const suffixMap: Record<string, string> = {
        'stereo': 'stereo',
        'binaural': 'binaural-HRTF',
        'ambisonic-foa': 'FOA-AmbiX',
      };
      const filename = `satie-export-${suffixMap[format]}-${sampleRate}Hz.wav`;
      downloadBlob(blob, filename);
    } catch (e) {
      console.error('[ExportPanel] Export failed:', e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
      setProgress(null);
    }
  }, [format, script, sampleBuffers, duration, sampleRate, bitDepth]);

  const handleStartVideoRecord = useCallback(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      setError('No canvas found — open the Space panel first');
      return;
    }

    try {
      const videoStream = canvas.captureStream(30);

      // Try to get audio from any existing AudioContext
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      // Connect to destination (this captures whatever is playing)
      // Note: this captures silence if nothing is playing through this context
      // The real audio comes from the engine's AudioContext

      const tracks = [...videoStream.getVideoTracks()];

      // Try to get audio tracks if available
      try {
        const existingCtx = (window as unknown as Record<string, unknown>).__satieAudioCtx as AudioContext | undefined;
        if (existingCtx) {
          const audioDest = existingCtx.createMediaStreamDestination();
          // This won't work perfectly — MediaRecorder needs the stream from the same context
          tracks.push(...audioDest.stream.getAudioTracks());
        }
      } catch {
        // Audio capture may not be available — record video only
      }

      const combined = new MediaStream(tracks);
      const recorder = new MediaRecorder(combined, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 5_000_000,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        downloadBlob(blob, 'satie-capture.webm');
        setRecording(false);
        dest.disconnect();
        audioCtx.close();
      };

      recorderRef.current = recorder;
      recorder.start(100); // collect data every 100ms
      setRecording(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video recording failed');
    }
  }, []);

  const handleStopVideoRecord = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  const progressPercent = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <div style={{
      padding: '10px 14px',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '11px',
      color: '#1a3a2a',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      height: '100%',
      overflow: 'auto',
    }}>
      {/* Format selector */}
      <div>
        <div style={styles.label}>Format</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {([
            ['stereo', 'Stereo'],
            ['binaural', 'Binaural'],
            ['ambisonic-foa', 'Ambisonic'],
            ['video', 'Video'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFormat(value)}
              style={{
                ...styles.chip,
                background: format === value ? '#1a3a2a' : 'none',
                color: format === value ? '#faf9f6' : '#1a3a2a',
                borderColor: format === value ? '#1a3a2a' : '#d0cdc4',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Format description */}
      <div style={{ fontSize: '9px', opacity: 0.35, lineHeight: '1.4' }}>
        {format === 'stereo' && '2ch WAV — standard stereo with equalpower panning'}
        {format === 'binaural' && '2ch WAV — HRTF binaural rendering for headphones'}
        {format === 'ambisonic-foa' && '4ch WAV — First-Order Ambisonics (AmbiX: W,Y,Z,X)'}
        {format === 'video' && 'WebM — real-time capture of the 3D viewport'}
      </div>

      {/* Audio export options */}
      {format !== 'video' && (
        <>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div>
              <div style={styles.label}>Duration (s)</div>
              <input
                type="number"
                min={1}
                max={600}
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
                style={styles.input}
              />
            </div>
            <div>
              <div style={styles.label}>Sample Rate</div>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value))}
                style={styles.input}
              >
                <option value={44100}>44.1 kHz</option>
                <option value={48000}>48 kHz</option>
                <option value={96000}>96 kHz</option>
              </select>
            </div>
            <div>
              <div style={styles.label}>Bit Depth</div>
              <select
                value={bitDepth}
                onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24)}
                style={styles.input}
              >
                <option value={16}>16-bit</option>
                <option value={24}>24-bit</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleExportAudio}
            disabled={exporting || !script.trim()}
            style={{
              ...styles.exportBtn,
              opacity: exporting || !script.trim() ? 0.4 : 1,
            }}
          >
            {exporting
              ? `${progress?.phase ?? 'preparing'}... ${progressPercent}%`
              : 'Export WAV'
            }
          </button>
        </>
      )}

      {/* Video export */}
      {format === 'video' && (
        <>
          <div style={{ fontSize: '9px', opacity: 0.3, lineHeight: '1.4' }}>
            Records the Space viewport in real-time. Start playback first, then record.
            {!isPlaying && ' (not playing)'}
          </div>

          {!recording ? (
            <button
              onClick={handleStartVideoRecord}
              style={styles.exportBtn}
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={handleStopVideoRecord}
              style={{
                ...styles.exportBtn,
                background: '#8b0000',
                borderColor: '#8b0000',
              }}
            >
              Stop Recording ({Math.floor(currentTime)}s)
            </button>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{ fontSize: '9px', color: '#8b0000', opacity: 0.8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    fontSize: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.35,
    marginBottom: '4px',
    fontWeight: 600,
  },
  chip: {
    padding: '3px 8px',
    border: '1px solid #d0cdc4',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '10px',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    transition: 'all 0.1s',
  },
  input: {
    width: 72,
    padding: '4px 6px',
    border: '1px solid #d0cdc4',
    borderRadius: 4,
    fontSize: '10px',
    fontFamily: "'SF Mono', monospace",
    background: 'transparent',
    color: '#1a3a2a',
    outline: 'none',
  },
  exportBtn: {
    padding: '6px 14px',
    background: '#1a3a2a',
    color: '#faf9f6',
    border: '1.5px solid #1a3a2a',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 600,
    transition: 'opacity 0.15s',
  },
};
