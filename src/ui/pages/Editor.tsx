import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useParams } from 'react-router-dom';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { SatieEditor } from '../components/SatieEditor';
import { SpatialViewport } from '../components/SpatialViewport';
import { AssetPanel } from '../components/AssetPanel';
import { type SampleEntry } from '../components/SamplesTab';
import { AIPanel, type AITarget } from '../components/AIPanel';
import { Sidebar, type PanelVisibility } from '../components/Sidebar';
import { Panel } from '../components/Panel';
import { useAuth } from '../../lib/AuthContext';
import { getSketch, updateSketch, createSketch } from '../../lib/sketches';
import { uploadSketchSamples, loadSketchSamples } from '../../lib/sampleStorage';
import { cacheSample } from '../../lib/sampleCache';
import { useSFX } from '../hooks/useSFX';
import { generateAudio } from '../../engine/audio/AudioGen';
import type { Statement } from '../../engine/core/Statement';
import { WanderType } from '../../engine/core/Statement';
import { registerTrajectoryFromLUT, getTrajectory } from '../../engine/spatial/Trajectories';
import { cacheTrajectory } from '../../lib/trajectoryCache';
import { generateTrajectoryFromPrompt, executeTrajectoryCode, postProcessTrajectory, type TrajectoryGenParams } from '../../engine/spatial/TrajectoryGen';
import { encodeWAV } from '../../engine/export/WAVEncoder';
import { captureCanvasThumbnail, uploadThumbnail } from '../../lib/thumbnailCapture';
import { supabase } from '../../lib/supabase';
import { VersionsPanel } from '../components/VersionsPanel';
import { DocsPanel } from '../components/DocsPanel';
import { createProvider } from '../../lib/aiProvider';
import { saveVersion } from '../../lib/versions';
import { ExportPanel } from '../components/ExportPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { updateFeedback, editDistanceRatio } from '../../lib/feedbackStore';

const DEFAULT_SCRIPT = `# satie\n`;
const AUTOSAVE_DELAY = 2000;

/** Memoized voices panel with mixer controls (mute/solo per voice) */
const VoicesPanel = memo(function VoicesPanel({
  statements,
  mutedIndices,
  soloedIndices,
  onToggleMute,
  onToggleSolo,
}: {
  statements: Statement[];
  mutedIndices: ReadonlySet<number>;
  soloedIndices: ReadonlySet<number>;
  onToggleMute: (index: number) => void;
  onToggleSolo: (index: number) => void;
}) {
  const hasSolo = soloedIndices.size > 0;

  return (
    <div style={{
      padding: '4px 14px 8px',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '11px',
      color: '#1a3a2a',
      overflow: 'auto',
      height: '100%',
    }}>
      {statements.length === 0 && (
        <span style={{ opacity: 0.25 }}>no statements</span>
      )}
      {statements.map((stmt, i) => {
        const isMuted = mutedIndices.has(i);
        const isSoloed = soloedIndices.has(i);
        const isAudible = !isMuted && (!hasSolo || isSoloed);

        return (
          <div key={i} style={{
            padding: '1px 0',
            opacity: stmt.mute ? 0.2 : isAudible ? 0.7 : 0.25,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <button
              onClick={() => onToggleMute(i)}
              title="Mute"
              style={{
                background: isMuted ? '#1a3a2a' : 'none',
                color: isMuted ? '#faf9f6' : '#1a3a2a',
                border: '1px solid #1a3a2a',
                borderRadius: 3,
                fontSize: '8px',
                fontWeight: 700,
                fontFamily: "'SF Mono', monospace",
                width: 16,
                height: 14,
                padding: 0,
                cursor: 'pointer',
                lineHeight: '14px',
                opacity: isMuted ? 1 : 0.4,
                flexShrink: 0,
              }}
            >
              M
            </button>
            <button
              onClick={() => onToggleSolo(i)}
              title="Solo"
              style={{
                background: isSoloed ? '#8b6914' : 'none',
                color: isSoloed ? '#faf9f6' : '#1a3a2a',
                border: `1px solid ${isSoloed ? '#8b6914' : '#1a3a2a'}`,
                borderRadius: 3,
                fontSize: '8px',
                fontWeight: 700,
                fontFamily: "'SF Mono', monospace",
                width: 16,
                height: 14,
                padding: 0,
                cursor: 'pointer',
                lineHeight: '14px',
                opacity: isSoloed ? 1 : 0.4,
                flexShrink: 0,
              }}
            >
              S
            </button>
            <span style={{ fontWeight: 600 }}>{stmt.kind}</span>{' '}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {stmt.clip.split('/').pop()}
            </span>
            {!stmt.every.isNull && (
              <span style={{ opacity: 0.4 }}> e:{stmt.every.toString()}</span>
            )}
            {stmt.reverbParams && <span style={{ color: '#8b0000' }}> rv</span>}
            {stmt.delayParams && <span style={{ color: '#8b0000' }}> dl</span>}
            {stmt.filterParams && <span style={{ color: '#8b0000' }}> fl</span>}
            {stmt.wanderType !== WanderType.None && (
              <span style={{ opacity: 0.4 }}> [{stmt.wanderType}]</span>
            )}
          </div>
        );
      })}
    </div>
  );
});

/** SVG overlay that draws a bezier "patch cord" from AI panel to its target panel */
const PatchCord = memo(function PatchCord({ target }: { target: AITarget }) {
  const [path, setPath] = useState('');
  const rafRef = useRef(0);

  useEffect(() => {
    const update = () => {
      const aiEl = document.querySelector('[data-panel-id="ai"]') as HTMLElement | null;
      const targetId = target === 'script' ? 'score' : 'samples';
      const targetEl = document.querySelector(`[data-panel-id="${targetId}"]`) as HTMLElement | null;

      if (aiEl && targetEl) {
        // AI panel: left edge center
        const aiRect = aiEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();
        // Get parent offset (the flex container)
        const parent = aiEl.parentElement;
        const pRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };

        const x1 = aiRect.left - pRect.left;
        const y1 = aiRect.top - pRect.top + aiRect.height * 0.35;
        const x2 = tRect.right - pRect.left;
        const y2 = tRect.top - pRect.top + tRect.height * 0.5;

        const dx = Math.abs(x2 - x1) * 0.5;
        setPath(`M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`);
      } else {
        setPath('');
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  if (!path) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <path
        d={path}
        fill="none"
        stroke="#000"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        opacity={0.2}
      />
    </svg>
  );
});

export function Editor() {
  const { sketchId } = useParams<{ sketchId?: string }>();
  const { user } = useAuth();
  const {
    engine: engineRef,
    uiState,
    tracksRef,
    loadScript,
    play,
    stop,
    loadAudioBuffer,
    loadAudioFile,
    setMasterVolume,
    toggleMute,
    toggleSolo,
    setListenerPosition,
    setListenerOrientation,
  } = useSatieEngine();

  const sfx = useSFX();
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [sketchTitle, setSketchTitle] = useState('Untitled');
  const [currentSketchId, setCurrentSketchId] = useState<string | undefined>(sketchId);
  const [isPublic, setIsPublic] = useState(false);
  const [sampleEntries, setSampleEntries] = useState<SampleEntry[]>([]);
  const [generatingTrajectory, setGeneratingTrajectory] = useState<string | null>(null);
  const [spaceBgColor, setSpaceBgColor] = useState(() => {
    // Per-sketch color, keyed by sketch ID; fall back to default
    if (sketchId) {
      return localStorage.getItem(`satie-bg-${sketchId}`) || '#f4f3ee';
    }
    return '#f4f3ee';
  });
  const handleBgColorChange = useCallback((color: string) => {
    setSpaceBgColor(color);
    if (currentSketchId) {
      localStorage.setItem(`satie-bg-${currentSketchId}`, color);
    }
  }, [currentSketchId]);
  const [panels, setPanels] = useState<PanelVisibility>({
    score: true,
    samples: true,
    space: true,
    voices: true,
    ai: true,
    docs: false,
    export: false,
    versions: false,
  });
  const [aiTarget, setAiTarget] = useState<AITarget>('script');
  const [workspaceZoom, setWorkspaceZoom] = useState(1);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Raw ArrayBuffers for samples loaded this session — used for uploading on save. */
  const sampleBuffers = useRef<Map<string, ArrayBuffer>>(new Map());

  // Load sketch from DB if we have an ID, then load its samples
  useEffect(() => {
    if (!sketchId) return;
    getSketch(sketchId).then(async (sketch) => {
      if (sketch) {
        setScript(sketch.script);
        setSketchTitle(sketch.title);
        setCurrentSketchId(sketch.id);
        setIsPublic(sketch.is_public);

        // Restore viewport background color: first try @bg comment in script, then localStorage
        const bgMatch = sketch.script.match(/^- @bg (#[0-9a-fA-F]{6})/m);
        if (bgMatch) {
          setSpaceBgColor(bgMatch[1]);
        } else {
          const savedBg = localStorage.getItem(`satie-bg-${sketch.id}`);
          if (savedBg) setSpaceBgColor(savedBg);
        }

        // Load samples from Supabase Storage (with IndexedDB cache)
        try {
          const loaded = await loadSketchSamples(sketch.id, async (name, data) => {
            await loadAudioBuffer(name, data);
            sampleBuffers.current.set(name, data);
          });
          if (loaded.length > 0) {
            setSampleEntries(prev => {
              const existing = new Set(prev.map(s => s.name));
              const newEntries = loaded.filter(n => !existing.has(n)).map(n => ({ name: n, category: 'imported' as const }));
              return [...prev, ...newEntries];
            });
          }
        } catch (e) {
          console.error('[Editor] Failed to load sketch samples:', e);
        }
      }
    }).catch(console.error);
  }, [sketchId, loadAudioBuffer]);

  // Autosave
  useEffect(() => {
    if (!user || !currentSketchId) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      updateSketch(currentSketchId, { script, title: sketchTitle }).catch(console.error);
    }, AUTOSAVE_DELAY);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [script, sketchTitle, user, currentSketchId]);

  // Apply `background` property from script to viewport
  useEffect(() => {
    for (const stmt of uiState.statements) {
      if (stmt.background) {
        setSpaceBgColor(stmt.background);
        if (currentSketchId) {
          localStorage.setItem(`satie-bg-${currentSketchId}`, stmt.background);
        }
        break; // first one wins
      }
    }
  }, [uiState.statements, currentSketchId]);

  const togglePanel = useCallback((key: keyof PanelVisibility) => {
    setPanels(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleRun = useCallback(() => {
    loadScript(script);
    if (!uiState.isPlaying) play();
  }, [script, loadScript, uiState.isPlaying, play]);

  const handleLoadBuffer = useCallback(async (name: string, data: ArrayBuffer, category: SampleEntry['category'] = 'imported') => {
    await loadAudioBuffer(name, data);
    sampleBuffers.current.set(name, data);
    // Cache locally in IndexedDB for fast reload
    cacheSample(name, data).catch(() => {});
    setSampleEntries(prev => {
      if (prev.some(s => s.name === name)) return prev;
      return [...prev, { name, category }];
    });
  }, [loadAudioBuffer]);

  const handleLoadFile = useCallback(async (name: string, url: string) => {
    await loadAudioFile(name, url);
    setSampleEntries(prev => {
      if (prev.some(s => s.name === name)) return prev;
      return [...prev, { name, category: 'imported' }];
    });
  }, [loadAudioFile]);

  // RLHF: track the last AI generation so we can measure user edits
  const lastGenRef = useRef<{ feedbackId: string; baseline: string } | null>(null);

  /** Flush implicit edit feedback for the previous generation before starting a new one. */
  const flushEditFeedback = useCallback(() => {
    if (!lastGenRef.current) return;
    const { feedbackId, baseline } = lastGenRef.current;
    const dist = editDistanceRatio(baseline, script);
    if (dist > 0) {
      updateFeedback(feedbackId, { userEditedOutput: script, editDistance: dist });
    }
    lastGenRef.current = null;
  }, [script]);

  const handleFeedbackCreated = useCallback((feedbackId: string, baseline: string) => {
    // Flush any previous generation's edit distance first
    flushEditFeedback();
    lastGenRef.current = { feedbackId, baseline };
  }, [flushEditFeedback]);

  const handleAIGenerate = useCallback((code: string) => {
    // Flush edit feedback for the previous generation before overwriting
    flushEditFeedback();
    setScript(code);
    // Auto-run: load the new script and play immediately
    loadScript(code);
    if (!uiState.isPlaying) play();
  }, [loadScript, uiState.isPlaying, play, flushEditFeedback]);

  const handleAISampleGenerate = useCallback(async (name: string, prompt: string) => {
    try {
      const ctx = new AudioContext();
      const audioBuffer = await generateAudio(ctx, prompt, name, false);
      // Convert AudioBuffer to ArrayBuffer (WAV) for storage
      const channels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      const sampleRate = audioBuffer.sampleRate;
      const bitsPerSample = 16;
      const dataSize = length * channels * (bitsPerSample / 8);
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      // WAV header
      const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
      view.setUint16(32, channels * (bitsPerSample / 8), true);
      view.setUint16(34, bitsPerSample, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);
      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < channels; ch++) {
          const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
      const clipName = `Audio/${name}`;
      await handleLoadBuffer(clipName, buffer, 'generated');
      ctx.close();
    } catch (e) {
      console.error('[Editor] Sample generation failed:', e);
    }
  }, [handleLoadBuffer]);

  const handleRecordSave = useCallback(async (name: string, data: ArrayBuffer) => {
    await handleLoadBuffer(name, data, 'recorded');
  }, [handleLoadBuffer]);

  const handleGenerateTrajectory = useCallback(async (name: string, code: string, params?: TrajectoryGenParams) => {
    setGeneratingTrajectory(name);
    try {
      const resolution = params?.resolution ?? 8192;
      const seed = params?.seed ?? 0;
      let points = executeTrajectoryCode(code, resolution, seed);

      // Post-process: smoothing and ground constraint
      if (params?.smoothing || params?.ground) {
        points = postProcessTrajectory(points, resolution, params.smoothing ?? 0, params.ground ?? false);
      }

      // Register in runtime
      registerTrajectoryFromLUT(name, points, resolution);

      // Persist to IndexedDB
      await cacheTrajectory({
        name,
        points,
        pointCount: resolution,
        description: name.replace(/_/g, ' '),
        source: 'generated',
        createdAt: Date.now(),
      });
    } catch (e) {
      console.error('[Editor] Trajectory generation failed:', e);
    } finally {
      setGeneratingTrajectory(null);
    }
  }, []);

  const handleDeleteSample = useCallback((name: string) => {
    setSampleEntries(prev => prev.filter(s => s.name !== name));
    sampleBuffers.current.delete(name);
  }, []);

  // Auto-generate trajectories when script contains `move gen`
  const generatedTrajRef = useRef(new Set<string>());
  useEffect(() => {
    for (const stmt of uiState.statements) {
      if (stmt.isGenTrajectory && stmt.genTrajectoryPrompt && stmt.customTrajectoryName) {
        const name = stmt.customTrajectoryName;
        if (!generatedTrajRef.current.has(name) && !getTrajectory(name)) {
          generatedTrajRef.current.add(name);
          try {
            const trajProvider = createProvider();
            const genParams: TrajectoryGenParams = {
              duration: stmt.genTrajectoryDuration,
              resolution: stmt.genTrajectoryResolution,
              smoothing: stmt.genTrajectorySmoothing,
              seed: stmt.genTrajectorySeed,
              ground: stmt.genTrajectoryGround,
              variation: stmt.genTrajectoryVariation,
            };
            generateTrajectoryFromPrompt(trajProvider, stmt.genTrajectoryPrompt, genParams)
              .then(spec => handleGenerateTrajectory(name, spec.code, genParams))
              .catch(e => console.error('[Editor] Auto trajectory gen failed:', e));
          } catch { /* no provider configured */ }
        }
      }
    }
  }, [uiState.statements, handleGenerateTrajectory]);

  const handleRestoreVersion = useCallback((restoredScript: string, restoredTitle: string) => {
    setScript(restoredScript);
    setSketchTitle(restoredTitle);
    loadScript(restoredScript);
  }, [loadScript]);

  const handleTogglePublic = useCallback(async () => {
    const newValue = !isPublic;
    setIsPublic(newValue);
    if (currentSketchId) {
      updateSketch(currentSketchId, { is_public: newValue }).catch(console.error);
    }
  }, [isPublic, currentSketchId]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    let sketchIdForSamples = currentSketchId;

    // Embed viewport bg color as a metadata comment in the script
    const DEFAULT_BG = '#f4f3ee';
    let scriptToSave = script;
    // Remove any existing @bg comment
    scriptToSave = scriptToSave.replace(/^- @bg #[0-9a-fA-F]{6}\n?/m, '');
    // Also remove legacy # @bg format
    scriptToSave = scriptToSave.replace(/^# @bg #[0-9a-fA-F]{6}\n?/m, '');
    // Prepend if non-default
    if (spaceBgColor !== DEFAULT_BG) {
      scriptToSave = `- @bg ${spaceBgColor}\n${scriptToSave}`;
    }

    if (currentSketchId) {
      await updateSketch(currentSketchId, { script: scriptToSave, title: sketchTitle, is_public: isPublic });
    } else {
      const sketch = await createSketch(user.id, sketchTitle, scriptToSave);
      setCurrentSketchId(sketch.id);
      sketchIdForSamples = sketch.id;
      window.history.replaceState(null, '', `/editor/${sketch.id}`);
    }

    // Capture any engine audio buffers (including gen audio) that aren't in sampleBuffers yet
    if (engineRef.current) {
      const engineBuffers = engineRef.current.getAudioBuffers();
      for (const [name, audioBuf] of engineBuffers) {
        if (!sampleBuffers.current.has(name)) {
          // Convert AudioBuffer → WAV ArrayBuffer so it can be uploaded
          const wavBlob = encodeWAV(audioBuf, 16);
          sampleBuffers.current.set(name, await wavBlob.arrayBuffer());
        }
      }
    }

    // Upload all samples (imported + generated) to Supabase Storage
    if (sketchIdForSamples && sampleBuffers.current.size > 0) {
      try {
        await uploadSketchSamples(user.id, sketchIdForSamples, sampleBuffers.current);
      } catch (e) {
        console.error('[Editor] Failed to upload samples:', e);
      }
    }

    // Save version snapshot (non-blocking)
    if (sketchIdForSamples) {
      saveVersion(sketchIdForSamples, sketchTitle, script).catch(() => {});
    }

    // Capture and upload thumbnail (non-blocking)
    if (sketchIdForSamples) {
      captureCanvasThumbnail().then(async (blob) => {
        if (blob) {
          await uploadThumbnail(supabase, user.id, sketchIdForSamples!, blob);
        }
      }).catch(() => {});
    }
  }, [user, currentSketchId, script, sketchTitle, isPublic]);

  const zoomBtnStyle: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 4,
    background: '#faf9f6',
    border: '1px solid #d0cdc4',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    color: '#1a3a2a',
    fontSize: '13px',
    fontFamily: "'SF Mono', monospace",
    lineHeight: 1,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#f4f3ee',
      overflow: 'hidden',
      display: 'flex',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <Sidebar
        isPlaying={uiState.isPlaying}
        currentTime={uiState.currentTime}
        trackCount={uiState.trackCount}
        onPlay={play}
        onStop={stop}
        onMasterVolume={setMasterVolume}
        panels={panels}
        onTogglePanel={togglePanel}
        sketchTitle={sketchTitle}
        onSketchTitleChange={setSketchTitle}
        onSave={user ? handleSave : undefined}
        canSave={!!user}
        isSaved={!!currentSketchId}
        isPublic={isPublic}
        onTogglePublic={handleTogglePublic}
        sketchId={currentSketchId}
      />

      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Workspace zoom controls */}
        <div style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          zIndex: 200,
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}>
          <button
            onClick={() => setWorkspaceZoom(z => Math.max(0.25, z - 0.1))}
            title="Zoom out workspace"
            style={zoomBtnStyle}
          >-</button>
          <button
            onClick={() => setWorkspaceZoom(1)}
            title="Reset zoom"
            style={{
              ...zoomBtnStyle,
              fontSize: '8px',
              width: 'auto',
              padding: '0 6px',
              fontFamily: "'SF Mono', monospace",
            }}
          >{Math.round(workspaceZoom * 100)}%</button>
          <button
            onClick={() => setWorkspaceZoom(z => Math.min(2, z + 0.1))}
            title="Zoom in workspace"
            style={zoomBtnStyle}
          >+</button>
        </div>

        {/* Scaled workspace container */}
        <div style={{
          width: `${100 / workspaceZoom}%`,
          height: `${100 / workspaceZoom}%`,
          transform: `scale(${workspaceZoom})`,
          transformOrigin: 'top left',
          position: 'relative',
        }}>
        {/* Patch cord — rendered first so it sits behind all panels */}
        {panels.ai && <PatchCord target={aiTarget} />}

        {panels.score && (
          <Panel
            panelId="score"
            title="Score"
            defaultX={16}
            defaultY={16}
            defaultWidth={480}
            defaultHeight={540}
            minWidth={280}
            minHeight={200}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <SatieEditor
                  value={script}
                  onChange={setScript}
                  onRun={handleRun}
                  errors={uiState.errors}
                />
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                borderTop: '1px solid #e8e0d8',
                gap: '8px',
              }}>
                <button
                  className="run-btn"
                  onClick={() => { sfx.play(); handleRun(); }}
                  onMouseEnter={sfx.hover}
                  style={{
                    padding: '3px 12px',
                    background: 'none',
                    border: '1.5px solid #1a3a2a',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    color: '#1a3a2a',
                    fontWeight: 500,
                  }}
                >
                  Run
                </button>
                <span style={{
                  fontSize: '9px',
                  opacity: 0.2,
                  fontFamily: "'SF Mono', monospace",
                }}>
                  Cmd+Enter
                </span>
              </div>
            </div>
          </Panel>
        )}

        {panels.samples && (
          <Panel
            panelId="samples"
            title="Assets"
            defaultX={16}
            defaultY={572}
            defaultWidth={480}
            defaultHeight={260}
            minWidth={240}
            minHeight={160}
          >
            <ErrorBoundary name="Assets">
              <AssetPanel
                samples={sampleEntries}
                onLoadBuffer={handleLoadBuffer}
                onDeleteSample={handleDeleteSample}
                onGenerateTrajectory={handleGenerateTrajectory}
                generatingTrajectory={generatingTrajectory}
              />
            </ErrorBoundary>
          </Panel>
        )}

        {panels.space && (
          <Panel
            panelId="space"
            title="Space"
            defaultX={512}
            defaultY={16}
            defaultWidth={500}
            defaultHeight={400}
            minWidth={280}
            minHeight={200}
          >
            <ErrorBoundary name="Space">
              <SpatialViewport tracksRef={tracksRef} bgColor={spaceBgColor} onBgColorChange={handleBgColorChange} onListenerMove={setListenerPosition} onListenerRotate={setListenerOrientation} />
            </ErrorBoundary>
          </Panel>
        )}

        {panels.voices && (
          <Panel
            panelId="voices"
            title="Voices"
            defaultX={512}
            defaultY={432}
            defaultWidth={240}
            defaultHeight={124}
            minWidth={160}
            minHeight={72}
          >
            <ErrorBoundary name="Voices">
              <VoicesPanel
                statements={uiState.statements}
                mutedIndices={uiState.mutedIndices}
                soloedIndices={uiState.soloedIndices}
                onToggleMute={toggleMute}
                onToggleSolo={toggleSolo}
              />
            </ErrorBoundary>
          </Panel>
        )}

        {panels.ai && (
          <Panel
            panelId="ai"
            title="sAtIe"
            defaultX={768}
            defaultY={432}
            defaultWidth={320}
            defaultHeight={300}
            minWidth={240}
            minHeight={160}
            borderColor="#1a3a2a"
          >
            <ErrorBoundary name="AI">
              <AIPanel
                onGenerate={handleAIGenerate}
                onGenerateSample={handleAISampleGenerate}
                onGenerateTrajectory={handleGenerateTrajectory}
                currentScript={script}
                loadedSamples={sampleEntries.map(s => s.name)}
                target={aiTarget}
                onTargetChange={setAiTarget}
                onFeedbackCreated={handleFeedbackCreated}
              />
            </ErrorBoundary>
          </Panel>
        )}

        {panels.export && (
          <Panel
            panelId="export"
            title="Export"
            defaultX={512}
            defaultY={432}
            defaultWidth={340}
            defaultHeight={280}
            minWidth={280}
            minHeight={200}
          >
            <ErrorBoundary name="Export">
              <ExportPanel
                script={script}
                sampleBuffers={sampleBuffers}
                engineRef={engineRef}
                isPlaying={uiState.isPlaying}
                currentTime={uiState.currentTime}
              />
            </ErrorBoundary>
          </Panel>
        )}

        {panels.docs && (
          <Panel
            panelId="docs"
            title="Reference"
            defaultX={768}
            defaultY={16}
            defaultWidth={380}
            defaultHeight={460}
            minWidth={280}
            minHeight={200}
          >
            <DocsPanel />
          </Panel>
        )}

        {panels.versions && (
          <Panel
            panelId="versions"
            title="Versions"
            defaultX={768}
            defaultY={16}
            defaultWidth={280}
            defaultHeight={300}
            minWidth={200}
            minHeight={140}
          >
            <ErrorBoundary name="Versions">
              <VersionsPanel
                sketchId={currentSketchId}
                onRestore={handleRestoreVersion}
              />
            </ErrorBoundary>
          </Panel>
        )}

        </div>{/* end scaled workspace */}
      </div>
    </div>
  );
}
