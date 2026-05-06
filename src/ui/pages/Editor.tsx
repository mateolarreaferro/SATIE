import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { useFaceTracking } from '../hooks/useFaceTracking';
import { SatieEditor } from '../components/SatieEditor';
import { SpatialViewport } from '../components/SpatialViewport';
import { ControlsHint } from '../components/ControlsHint';
import { AssetPanel } from '../components/AssetPanel';
import { type SampleEntry } from '../components/SamplesTab';
import { AIPanel, type AITarget } from '../components/AIPanel';
import { Sidebar, type PanelVisibility, type PopoverType } from '../components/Sidebar';
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
import { downloadCommunitySampleByName, getPopularSamples, type CommunitySample } from '../../lib/communitySamples';
import { findCommunityMatch } from '../../lib/communitySearch';
import { getPreferCommunitySamples } from '../../lib/userSettings';
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
import { useTheme } from '../theme/ThemeContext';
import { RADIUS, SHADOW, FONT } from '../theme/tokens';

const DEFAULT_SCRIPT = `# satie\n`;

const FIRST_TIME_SCRIPT = `# welcome to satie — press Cmd+Enter to play

loop gen gentle rain
  volume 0.3
  fade_in 2

loop gen bird singing
  move spiral
  volume 0.2

# try changing "spiral" to "orbit" or "lorenz" and re-run
# open the AI panel in the sidebar to generate entire scenes
`;

const FIRST_TIME_KEY = 'satie-first-visit-done';
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
  const { theme } = useTheme();
  const hasSolo = soloedIndices.size > 0;

  return (
    <div style={{
      padding: '4px 14px 8px',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '16px',
      color: theme.text,
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
              aria-label={isMuted ? `Unmute ${stmt.clip}` : `Mute ${stmt.clip}`}
              aria-pressed={isMuted}
              style={{
                background: isMuted ? theme.accent : 'none',
                color: isMuted ? theme.accentText : theme.accent,
                border: `1px solid ${theme.accent}`,
                borderRadius: 3,
                fontSize: '16px',
                fontWeight: 700,
                fontFamily: "'SF Mono', monospace",
                width: 22,
                height: 20,
                padding: 0,
                cursor: 'pointer',
                lineHeight: '20px',
                opacity: isMuted ? 1 : 0.5,
                flexShrink: 0,
              }}
            >
              M
            </button>
            <button
              onClick={() => onToggleSolo(i)}
              title="Solo"
              aria-label={isSoloed ? `Unsolo ${stmt.clip}` : `Solo ${stmt.clip}`}
              aria-pressed={isSoloed}
              style={{
                background: isSoloed ? theme.warn : 'none',
                color: isSoloed ? theme.accentText : theme.accent,
                border: `1px solid ${isSoloed ? theme.warn : theme.accent}`,
                borderRadius: 3,
                fontSize: '16px',
                fontWeight: 700,
                fontFamily: "'SF Mono', monospace",
                width: 22,
                height: 20,
                padding: 0,
                cursor: 'pointer',
                lineHeight: '20px',
                opacity: isSoloed ? 1 : 0.5,
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
            {stmt.reverbParams && <span style={{ color: theme.danger }}> rv</span>}
            {stmt.delayParams && <span style={{ color: theme.danger }}> dl</span>}
            {stmt.filterParams && <span style={{ color: theme.danger }}> fl</span>}
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
  const { theme } = useTheme();
  const [path, setPath] = useState('');
  const rafRef = useRef(0);

  useEffect(() => {
    let lastUpdate = 0;
    const THROTTLE_MS = 66; // ~15fps — panels don't move fast

    const update = (now: number) => {
      if (now - lastUpdate >= THROTTLE_MS) {
        lastUpdate = now;
        const aiEl = document.querySelector('[data-panel-id="ai"]') as HTMLElement | null;
        const targetId = target === 'script' ? 'score' : 'samples';
        const targetEl = document.querySelector(`[data-panel-id="${targetId}"]`) as HTMLElement | null;

        if (aiEl && targetEl) {
          // Panels use transform during drag, so offsetLeft/Top stay at the
          // pre-drag layout position. Read getBoundingClientRect to follow the
          // visual position, then divide by the parent's CSS scale to convert
          // from screen pixels back into the SVG's layout coord space.
          const parent = aiEl.parentElement;
          const pRect = parent?.getBoundingClientRect() ?? new DOMRect(0, 0, 1, 1);
          const pOffsetW = parent?.offsetWidth || 1;
          const scale = pRect.width / pOffsetW || 1;

          const aiRect = aiEl.getBoundingClientRect();
          const tRect = targetEl.getBoundingClientRect();

          const x1 = (aiRect.left - pRect.left) / scale;
          const y1 = (aiRect.top - pRect.top + aiRect.height * 0.35) / scale;
          const x2 = (tRect.right - pRect.left) / scale;
          const y2 = (tRect.top - pRect.top + tRect.height * 0.5) / scale;

          const dx = Math.abs(x2 - x1) * 0.5;
          setPath(`M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`);
        } else {
          setPath('');
        }
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
        stroke={theme.accent}
        strokeWidth={1.5}
        strokeDasharray="6 4"
        opacity={0.3}
      />
    </svg>
  );
});

export function Editor() {
  const { sketchId } = useParams<{ sketchId?: string }>();
  const location = useLocation();
  const templateState = (location.state as { templateTitle?: string; templateScript?: string } | null);
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
    setOnMissingBuffer,
    setOnSearchCommunity,
    setPreferCommunity,
  } = useSatieEngine();

  const faceTracking = useFaceTracking(setListenerOrientation);
  const sfx = useSFX();
  const { theme } = useTheme();
  // First-time experience: show a demo composition on first visit
  const isFirstTime = !sketchId && !templateState?.templateScript && !localStorage.getItem(FIRST_TIME_KEY);
  const initialScript = templateState?.templateScript ?? (isFirstTime ? FIRST_TIME_SCRIPT : DEFAULT_SCRIPT);
  const initialTitle = templateState?.templateTitle ?? (isFirstTime ? 'Welcome' : 'Untitled');

  if (isFirstTime) {
    localStorage.setItem(FIRST_TIME_KEY, '1');
  }

  const [script, setScript] = useState(initialScript);
  const [sketchTitle, setSketchTitle] = useState(initialTitle);
  const [currentSketchId, setCurrentSketchId] = useState<string | undefined>(sketchId);
  const [isPublic, setIsPublic] = useState(false);
  const [sampleEntries, setSampleEntries] = useState<SampleEntry[]>([]);
  const [generatingTrajectory, setGeneratingTrajectory] = useState<string | null>(null);
  const [communitySampleNames, setCommunitySampleNames] = useState<string[]>([]);
  const [spaceBgColor, setSpaceBgColor] = useState(() => {
    // Per-sketch color, keyed by sketch ID; fall back to black default
    if (sketchId) {
      return localStorage.getItem(`satie-bg-${sketchId}`) || '#000000';
    }
    return '#000000';
  });
  const handleBgColorChange = useCallback((color: string) => {
    setSpaceBgColor(color);
    if (currentSketchId) {
      localStorage.setItem(`satie-bg-${currentSketchId}`, color);
    }
  }, [currentSketchId]);
  const [panels, setPanels] = useState<PanelVisibility>({
    samples: false,
    voices: false,
    ai: isFirstTime,
  });
  const [activePopover, setActivePopover] = useState<PopoverType>(null);
  const [aiTarget, setAiTarget] = useState<AITarget>('script');
  const [workspaceZoom, setWorkspaceZoom] = useState(0.9);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Raw ArrayBuffers for samples loaded this session — used for uploading on save. */
  const sampleBuffers = useRef<Map<string, ArrayBuffer>>(new Map());

  // Dirty tracking — last saved snapshot. Updated on successful save AND on
  // sketch-load (so freshly-loaded sketches start clean).
  const [lastSavedScript, setLastSavedScript] = useState(initialScript);
  const [lastSavedTitle, setLastSavedTitle] = useState(initialTitle);
  const isDirty = script !== lastSavedScript || sketchTitle !== lastSavedTitle;

  // Mobile gate — workspace requires desktop viewport.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsNarrow(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Escape-to-close on popovers.
  useEffect(() => {
    if (!activePopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setActivePopover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePopover]);

  // Fetch community sample names for editor autocomplete
  useEffect(() => {
    getPopularSamples(100)
      .then(samples => setCommunitySampleNames(samples.map(s => s.name)))
      .catch(() => {});
  }, []);

  // Wire community sample resolution for lazy loading + community-first gen
  useEffect(() => {
    setOnMissingBuffer(async (clipName: string) => {
      const name = clipName.startsWith('community/') ? clipName.slice(10) : clipName;
      return downloadCommunitySampleByName(name);
    });
    setOnSearchCommunity((prompt: string) => findCommunityMatch(prompt));
    setPreferCommunity(getPreferCommunitySamples());
    return () => {
      setOnMissingBuffer(null);
      setOnSearchCommunity(null);
    };
  }, [setOnMissingBuffer, setOnSearchCommunity, setPreferCommunity]);

  // Load sketch from DB if we have an ID, then load its samples
  useEffect(() => {
    if (!sketchId) return;
    getSketch(sketchId).then(async (sketch) => {
      if (sketch) {
        setScript(sketch.script);
        setSketchTitle(sketch.title);
        setCurrentSketchId(sketch.id);
        setIsPublic(sketch.is_public);
        // Loaded from DB → mark as clean.
        setLastSavedScript(sketch.script);
        setLastSavedTitle(sketch.title);

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
      updateSketch(currentSketchId, { script, title: sketchTitle })
        .then(() => {
          // Mark clean once persisted.
          setLastSavedScript(script);
          setLastSavedTitle(sketchTitle);
        })
        .catch(console.error);
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

  const togglePopover = useCallback((p: 'docs' | 'export' | 'versions') => {
    setActivePopover(prev => prev === p ? null : p);
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
    // Mark clean after successful persist.
    setLastSavedScript(script);
    setLastSavedTitle(sketchTitle);

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
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    background: theme.cardBg,
    border: `1px solid ${theme.cardBorder}`,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    color: theme.accent,
    fontSize: '15px',
    fontFamily: "'SF Mono', monospace",
    lineHeight: 1,
    boxShadow: SHADOW.sm,
  };

  // Mobile gate — Editor's floating-panel layout doesn't degrade gracefully under 768px.
  if (isNarrow) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: theme.bg,
        color: theme.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, marginBottom: 16 }}>
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <h1 style={{ fontSize: FONT.size.xl, fontWeight: FONT.weight.semibold, margin: '0 0 8px' }}>
          Editor needs a desktop screen
        </h1>
        <p style={{ fontSize: FONT.size.md, opacity: 0.65, maxWidth: 320, lineHeight: 1.5, margin: '0 0 20px' }}>
          The Satie editor uses a wide multi-panel layout that doesn't fit on narrow screens. Open this page on a laptop or desktop to compose.
        </p>
        <a
          href="/explore"
          style={{
            background: theme.invertedBg,
            color: theme.invertedText,
            padding: '10px 18px',
            borderRadius: RADIUS.pill,
            fontSize: FONT.size.body,
            fontWeight: FONT.weight.medium,
            textDecoration: 'none',
          }}
        >
          Browse public sketches instead
        </a>
      </div>
    );
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: theme.bg,
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
        activePopover={activePopover}
        onTogglePopover={togglePopover}
        onSave={user ? handleSave : undefined}
        canSave={!!user}
        isDirty={isDirty}
        isPublic={isPublic}
        onTogglePublic={handleTogglePublic}
        sketchId={currentSketchId}
      />

      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Sketch title + saved-state indicator */}
        <div style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`,
            borderRadius: RADIUS.sm,
            padding: '4px 10px',
            boxShadow: SHADOW.sm,
            maxWidth: 320,
          }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke={theme.accent} strokeWidth="1.2" style={{ opacity: 0.5, flexShrink: 0 }}>
              <path d="M2.5 1.5h7l2.5 2.5v8h-10v-10.5z" strokeLinejoin="round"/>
            </svg>
            <input
              value={sketchTitle}
              onChange={(e) => setSketchTitle(e.target.value)}
              placeholder="Untitled"
              title="Sketch title"
              aria-label="Sketch title"
              style={{
                width: 220,
                fontSize: FONT.size.body,
                fontFamily: "'Inter', system-ui, sans-serif",
                color: theme.text,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: 0,
                fontWeight: 500,
              }}
            />
          </div>
          {user && (
            <span
              role="status"
              aria-live="polite"
              style={{
                fontSize: FONT.size.xs,
                fontWeight: 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: isDirty ? theme.warn : theme.textMuted,
                fontFamily: "'Inter', system-ui, sans-serif",
                whiteSpace: 'nowrap',
              }}
            >
              {isDirty ? 'unsaved' : 'saved'}
            </span>
          )}
        </div>

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
              fontSize: '16px',
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

        {/* Score — always visible */}
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
                runtimeWarnings={uiState.runtimeWarnings}
                communitySamples={communitySampleNames}
              />
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 12px',
              borderTop: `1px solid ${theme.cardBorder}`,
              gap: '8px',
            }}>
              <button
                className="run-btn"
                onClick={() => { sfx.play(); handleRun(); }}
                onMouseEnter={sfx.hover}
                aria-label="Run script"
                style={{
                  padding: '3px 12px',
                  background: 'none',
                  border: `1.5px solid ${theme.accent}`,
                  borderRadius: RADIUS.md,
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  color: theme.accent,
                  fontWeight: 500,
                }}
              >
                Run
              </button>
              <span style={{
                fontSize: '16px',
                opacity: 0.4,
                color: theme.text,
                fontFamily: "'SF Mono', monospace",
              }}>
                Cmd+Enter
              </span>
            </div>
          </div>
        </Panel>

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

        {/* Space — always visible */}
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
            <SpatialViewport
              tracksRef={tracksRef}
              bgColor={spaceBgColor}
              onBgColorChange={handleBgColorChange}
              onListenerMove={setListenerPosition}
              onListenerRotate={setListenerOrientation}
              faceTracking={{
                enabled: faceTracking.enabled,
                meshRef: faceTracking.meshRef,
                toggle: faceTracking.toggle,
                loading: faceTracking.loading,
                error: faceTracking.error,
              }}
            />
          </ErrorBoundary>
        </Panel>

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
            borderColor={theme.accent}
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

        </div>{/* end scaled workspace */}

        {/* Popover overlays — rendered outside the scaled workspace so they stay at native size */}
        {activePopover === 'export' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-popover-title"
            style={{
              position: 'absolute',
              left: 16,
              bottom: 48,
              width: 340,
              maxHeight: 'calc(100vh - 100px)',
              background: theme.cardBg,
              border: `1.5px solid ${theme.cardBorder}`,
              borderRadius: RADIUS.lg,
              boxShadow: SHADOW.lg,
              zIndex: 300,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px 8px',
              borderBottom: `1px solid ${theme.cardBorder}`,
            }}>
              <span id="export-popover-title" style={{ fontSize: '16px', fontWeight: 600, color: theme.text, fontFamily: "'Inter', system-ui, sans-serif" }}>Export</span>
              <button
                onClick={() => setActivePopover(null)}
                aria-label="Close export panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: theme.text, opacity: 0.5, padding: 0, lineHeight: 1 }}
              >&times;</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <ErrorBoundary name="Export">
                <ExportPanel
                  script={script}
                  sampleBuffers={sampleBuffers}
                  engineRef={engineRef}
                  isPlaying={uiState.isPlaying}
                  currentTime={uiState.currentTime}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {activePopover === 'docs' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="docs-popover-title"
            style={{
              position: 'absolute',
              left: 16,
              bottom: 48,
              width: 380,
              height: 'calc(100vh - 100px)',
              background: theme.cardBg,
              border: `1.5px solid ${theme.cardBorder}`,
              borderRadius: RADIUS.lg,
              boxShadow: SHADOW.lg,
              zIndex: 300,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px 8px',
              borderBottom: `1px solid ${theme.cardBorder}`,
            }}>
              <span id="docs-popover-title" style={{ fontSize: '16px', fontWeight: 600, color: theme.text, fontFamily: "'Inter', system-ui, sans-serif" }}>Reference</span>
              <button
                onClick={() => setActivePopover(null)}
                aria-label="Close docs panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: theme.text, opacity: 0.5, padding: 0, lineHeight: 1 }}
              >&times;</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <DocsPanel />
            </div>
          </div>
        )}

        {activePopover === 'versions' && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="versions-popover-title"
            style={{
              position: 'absolute',
              left: 16,
              top: 16,
              width: 280,
              maxHeight: 340,
              background: theme.cardBg,
              border: `1.5px solid ${theme.cardBorder}`,
              borderRadius: RADIUS.lg,
              boxShadow: SHADOW.lg,
              zIndex: 300,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px 8px',
              borderBottom: `1px solid ${theme.cardBorder}`,
            }}>
              <span id="versions-popover-title" style={{ fontSize: '16px', fontWeight: 600, color: theme.text, fontFamily: "'Inter', system-ui, sans-serif" }}>Versions</span>
              <button
                onClick={() => setActivePopover(null)}
                aria-label="Close versions panel"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: theme.text, opacity: 0.5, padding: 0, lineHeight: 1 }}
              >&times;</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <ErrorBoundary name="Versions">
                <VersionsPanel
                  sketchId={currentSketchId}
                  onRestore={handleRestoreVersion}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {/* Unified controls hint — rendered at the workspace level (outside
            any panel) so it's always visible alongside the editor chrome. */}
        {uiState.trackCount > 0 && (
          <ControlsHint position={{ bottom: 16, left: '50%', transform: 'translateX(-50%)' }} />
        )}
      </div>
    </div>
  );
}
