import { useState, useRef, useCallback, useEffect } from 'react';
import { generateTrajectoryFromPrompt } from '../../engine/spatial/TrajectoryGen';
import {
  createProvider,
  getPreferredProvider,
  setPreferredProvider,
  type AIProviderType,
} from '../../lib/aiProvider';
import {
  saveFeedback,
  updateFeedback,
  createFeedbackEntry,
} from '../../lib/feedbackStore';
import {
  generateCode,
  generateSampleSpec,
  generateEnsemble,
  refineScript,
  type RefinementProgress,
} from '../../lib/aiGenerate';

export type AITarget = 'script' | 'sample' | 'trajectory';

interface AIPanelProps {
  onGenerate: (code: string) => void;
  onGenerateSample: (name: string, prompt: string) => void;
  onGenerateTrajectory?: (name: string, prompt: string) => void;
  currentScript?: string;
  loadedSamples?: string[];
  target: AITarget;
  onTargetChange: (target: AITarget) => void;
  /** Called when a new generation is saved to feedback store (for implicit edit tracking) */
  onFeedbackCreated?: (feedbackId: string, baseline: string) => void;
}

interface HistoryEntry {
  prompt: string;
  result: string;
  timestamp: number;
  target: AITarget;
  feedbackId: string | null;
}

// ── ASR: Microphone → Whisper transcription ────────────────

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = localStorage.getItem('satie-openai-key') ?? '';
  if (!apiKey) throw new Error('Set your OpenAI key in dashboard settings first.');

  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper API ${res.status}`);
  const data = await res.json();
  return data.text ?? '';
}

function useASR(onTranscription: (text: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const elapsed = Date.now() - startTime.current;
        setRecording(false);
        if (elapsed < 300) return;

        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text.trim()) onTranscription(text.trim());
        } catch (e: any) {
          onError(e.message);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.current = recorder;
      startTime.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      onError('Microphone access denied');
    }
  }, [onTranscription, onError]);

  const stop = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  return { recording, transcribing, start, stop };
}




// ── React component ────────────────────────────────────────

// NOTE: buildSystemPrompt, buildEnrichedPrompt, cleanGeneratedCode, checkLibrary,
// callAI, verifyAndRepair, generateCode, generateSampleSpec have been extracted
// to src/lib/aiGenerate.ts for reuse across components.


export function AIPanel({
  onGenerate,
  onGenerateSample,
  onGenerateTrajectory,
  currentScript,
  loadedSamples = [],
  target,
  onTargetChange,
  onFeedbackCreated,
}: AIPanelProps) {
  const [prompts, setPrompts] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ensemble & refinement modes
  const [ensembleMode, setEnsembleMode] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Generation history (Option A: linear stack)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = current/new

  // RLHF: track ratings for the currently viewed history entry
  const [feedbackRatings, setFeedbackRatings] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [prompts]);

  const restoreHistory = useCallback((index: number) => {
    if (index < 0 || index >= history.length) return;

    // Mark the entry we're navigating AWAY from as undone
    if (historyIndex >= 0 && historyIndex !== index) {
      const prevEntry = history[historyIndex];
      if (prevEntry.feedbackId) {
        updateFeedback(prevEntry.feedbackId, { wasUndone: true });
      }
    }

    const entry = history[index];
    setHistoryIndex(index);
    if (entry.target === 'script' && /\b(loop|oneshot)\b/.test(entry.result)) {
      onGenerate(entry.result);
    }
  }, [history, historyIndex, onGenerate]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;

    setPrompts(prev => [...prev, prompt]);
    setInput('');
    setStatus(null);
    setIsLoading(true);

    try {
      // Validate that a provider is available
      createProvider();
    } catch {
      setStatus('No AI provider configured. Add an API key in dashboard settings.');
      setIsLoading(false);
      return;
    }

    try {
      if (target === 'trajectory') {
        // Trajectory generation mode
        const provider = createProvider();
        const spec = await generateTrajectoryFromPrompt(provider, prompt);
        setStatus(`generating trajectory "${spec.name}"...`);

        if (onGenerateTrajectory) {
          onGenerateTrajectory(spec.name, spec.code);
        }

        const fb = createFeedbackEntry(prompt, `trajectory: ${spec.name}`, 'trajectory');
        saveFeedback(fb);

        const entry: HistoryEntry = {
          prompt,
          result: `trajectory: ${spec.name}`,
          timestamp: Date.now(),
          target: 'trajectory',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      } else if (target === 'sample') {
        // Sample generation mode
        const spec = await generateSampleSpec(prompt);
        setStatus(`generating "${spec.name}"...`);

        onGenerateSample(spec.name, spec.prompt);

        const fb = createFeedbackEntry(prompt, `sample: ${spec.name} (${spec.prompt})`, 'sample');
        saveFeedback(fb);

        const entry: HistoryEntry = {
          prompt,
          result: `sample: ${spec.name} (${spec.prompt})`,
          timestamp: Date.now(),
          target: 'sample',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      } else {
        // Script generation mode
        // Build lightweight conversation context — only user prompts, not full
        // generated scripts (which can be 500-2000 tokens each and inflate cost).
        // The current script is already sent via buildEnrichedPrompt.
        const recentHistory = history
          .filter(h => h.target === 'script')
          .slice(-3)
          .flatMap(h => [
            { role: 'user', content: h.prompt },
            { role: 'assistant', content: `[generated ${h.result.split('\n').length} line script]` },
          ]);

        let resultCode: string;
        let resultError: string | null = null;

        if (ensembleMode) {
          // Ensemble: generate 3 candidates, pick the best
          setStatus('generating 3 candidates...');
          const ensemble = await generateEnsemble(
            prompt, currentScript, loadedSamples, recentHistory, 3,
          );
          resultCode = ensemble.best.code;
          resultError = ensemble.best.error;
          const validCount = ensemble.candidates.filter(c => c.score.parseValid).length;
          setStatus(`best of ${validCount}/${ensemble.candidates.length} — score ${(ensemble.best.score.total * 100).toFixed(0)}%`);
        } else {
          const result = await generateCode(
            prompt, currentScript, loadedSamples, recentHistory,
          );
          resultCode = result.code;
          resultError = result.error;
        }

        if (/\b(loop|oneshot)\b/.test(resultCode)) {
          onGenerate(resultCode);
        }

        if (resultError) {
          setStatus(`warning: ${resultError}`);
        }

        // Save feedback entry for RLHF
        const fb = createFeedbackEntry(prompt, resultCode, 'script');
        saveFeedback(fb);
        onFeedbackCreated?.(fb.id, resultCode);

        const entry: HistoryEntry = {
          prompt,
          result: resultCode,
          timestamp: Date.now(),
          target: 'script',
          feedbackId: fb.id,
        };
        setHistory(prev => {
          const truncated = historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : prev;
          return [...truncated, entry];
        });
        setHistoryIndex(-1);
      }
    } catch (e: any) {
      setStatus(`error: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [prompts, onGenerate, onGenerateSample, currentScript, loadedSamples, target, history, historyIndex]);

  const send = useCallback(() => {
    sendPrompt(input.trim());
  }, [input, sendPrompt]);

  // ASR
  const handleTranscription = useCallback((text: string) => {
    sendPrompt(text);
  }, [sendPrompt]);

  const handleASRError = useCallback((msg: string) => {
    setStatus(`mic: ${msg}`);
  }, []);

  const asr = useASR(handleTranscription, handleASRError);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // RLHF rating handler
  const handleRate = useCallback((rating: 1 | -1) => {
    const idx = historyIndex >= 0 ? historyIndex : history.length - 1;
    if (idx < 0 || idx >= history.length) return;
    const entry = history[idx];
    if (!entry.feedbackId) return;

    const currentRating = feedbackRatings.get(entry.feedbackId) ?? 0;
    const newRating = currentRating === rating ? 0 : rating; // toggle off if same
    setFeedbackRatings(prev => new Map(prev).set(entry.feedbackId!, newRating));
    updateFeedback(entry.feedbackId, { rating: newRating });
  }, [history, historyIndex, feedbackRatings]);

  // Refinement handler — polishes the current script
  const handleRefine = useCallback(async () => {
    if (!currentScript || isRefining) return;
    const lastPrompt = history.length > 0 ? history[history.length - 1].prompt : 'spatial composition';
    setIsRefining(true);
    setStatus('refining...');

    try {
      const result = await refineScript(
        currentScript,
        lastPrompt,
        loadedSamples,
        3,
        (progress: RefinementProgress) => {
          setStatus(`refining ${progress.round}/${progress.totalRounds} — ${(progress.currentScore * 100).toFixed(0)}%`);
        },
      );

      if (result.improvements.length > 0) {
        onGenerate(result.code);
        setStatus(`refined: ${result.improvements.length} improvement${result.improvements.length > 1 ? 's' : ''} — ${(result.score.total * 100).toFixed(0)}%`);

        const fb = createFeedbackEntry(`refine: ${lastPrompt}`, result.code, 'script');
        saveFeedback(fb);
        onFeedbackCreated?.(fb.id, result.code);

        const entry: HistoryEntry = {
          prompt: `refine: ${lastPrompt}`,
          result: result.code,
          timestamp: Date.now(),
          target: 'script',
          feedbackId: fb.id,
        };
        setHistory(prev => [...prev, entry]);
        setHistoryIndex(-1);
      } else {
        setStatus('already well-composed — no improvements found');
      }
    } catch (e: any) {
      setStatus(`refine error: ${e.message}`);
    } finally {
      setIsRefining(false);
    }
  }, [currentScript, loadedSamples, history, isRefining, onGenerate, onFeedbackCreated]);

  const targetBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    background: active ? '#1a1a1a' : 'none',
    color: active ? '#fff' : '#1a1a1a',
    border: '1px solid #1a1a1a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 500,
    letterSpacing: '0.03em',
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Target selector */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '0 14px 6px',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <button
          onClick={() => onTargetChange('script')}
          style={targetBtnStyle(target === 'script')}
        >
          Script
        </button>
        <button
          onClick={() => onTargetChange('sample')}
          style={targetBtnStyle(target === 'sample')}
        >
          Sample
        </button>
        <button
          onClick={() => onTargetChange('trajectory')}
          style={targetBtnStyle(target === 'trajectory')}
        >
          Trajectory
        </button>
        <select
          value={getPreferredProvider()}
          onChange={(e) => {
            setPreferredProvider(e.target.value as AIProviderType);
            setStatus(null);
          }}
          title="AI Provider — all configured providers are available as fallback"
          style={{
            fontSize: '16px',
            opacity: 0.4,
            marginLeft: 'auto',
            fontFamily: "'SF Mono', monospace",
            background: 'transparent',
            border: '1px solid #d0cdc4',
            borderRadius: 4,
            padding: '1px 4px',
            color: '#1a3a2a',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="anthropic">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
      </div>

      {/* Ensemble toggle + Refine button (script mode only) */}
      {target === 'script' && (
        <div style={{
          display: 'flex',
          gap: '6px',
          padding: '0 14px 6px',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setEnsembleMode(!ensembleMode)}
            title="Ensemble mode: generate 3 candidates and pick the best"
            style={{
              padding: '1px 7px',
              background: ensembleMode ? '#1a3a2a' : 'none',
              color: ensembleMode ? '#fff' : '#1a3a2a',
              border: `1px solid ${ensembleMode ? '#1a3a2a' : '#d0cdc4'}`,
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: "'SF Mono', monospace",
              opacity: ensembleMode ? 1 : 0.5,
              transition: 'all 0.15s',
            }}
          >
            ensemble
          </button>
          <button
            onClick={handleRefine}
            disabled={!currentScript || isRefining || isLoading}
            title="Iteratively refine the current script (3 rounds)"
            style={{
              padding: '1px 7px',
              background: 'none',
              color: '#1a3a2a',
              border: '1px solid #d0cdc4',
              borderRadius: 5,
              cursor: (!currentScript || isRefining || isLoading) ? 'default' : 'pointer',
              fontSize: '12px',
              fontFamily: "'SF Mono', monospace",
              opacity: (!currentScript || isRefining || isLoading) ? 0.2 : 0.5,
              transition: 'all 0.15s',
            }}
          >
            {isRefining ? 'refining...' : 'refine'}
          </button>
        </div>
      )}

      {/* Prompt log — only shows user prompts, no code output */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 14px',
          fontSize: '16px',
        }}
      >
        {prompts.length === 0 && !status && (
          <div style={{ opacity: 0.2, fontSize: '16px', padding: '4px 0' }}>
            {target === 'script'
              ? 'describe what you want to hear'
              : 'describe the sample you need'}
          </div>
        )}
        {prompts.map((p, i) => (
          <div key={i} style={{
            padding: '3px 0',
            color: '#1a3a2a',
            opacity: 0.4,
            fontSize: '16px',
            fontStyle: 'italic',
          }}>
            {p}
          </div>
        ))}
        {status && (
          <div style={{
            padding: '3px 0',
            color: status.startsWith('error') ? '#8b0000' : '#1a3a2a',
            opacity: 0.5,
            fontSize: '15px',
            fontFamily: "'SF Mono', monospace",
          }}>
            {status}
          </div>
        )}
        {asr.recording && (
          <div style={{ opacity: 0.4, fontSize: '16px', padding: '4px 0', color: '#8b0000' }}>recording...</div>
        )}
        {asr.transcribing && (
          <div style={{ opacity: 0.3, fontSize: '16px', padding: '4px 0' }}>transcribing...</div>
        )}
        {isLoading && (
          <div style={{ opacity: 0.2, fontSize: '16px', padding: '4px 0' }}>...</div>
        )}
      </div>

      {/* History navigation — shows prompt for the active entry */}
      {history.length > 0 && (
        <div style={{
          borderTop: '1px solid #e8e0d8',
          flexShrink: 0,
          padding: '4px 14px 2px',
        }}>
          {historyIndex >= 0 && (
            <div style={{
              fontSize: '15px',
              color: '#1a3a2a',
              opacity: 0.5,
              fontStyle: 'italic',
              padding: '0 0 3px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {history[historyIndex].prompt}
            </div>
          )}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            <button
              onClick={() => restoreHistory(historyIndex <= 0 ? 0 : (historyIndex < 0 ? history.length - 2 : historyIndex - 1))}
              disabled={history.length <= 1 || historyIndex === 0}
              style={{
                background: 'none',
                border: 'none',
                cursor: history.length <= 1 || historyIndex === 0 ? 'default' : 'pointer',
                opacity: history.length <= 1 || historyIndex === 0 ? 0.15 : 0.5,
                fontSize: '16px',
                color: '#1a3a2a',
                padding: '0 4px',
              }}
            >
              &lt;
            </button>
            <span style={{
              fontSize: '16px',
              opacity: 0.3,
              fontFamily: "'SF Mono', monospace",
              minWidth: '32px',
              textAlign: 'center',
            }}>
              {historyIndex < 0 ? history.length : historyIndex + 1}/{history.length}
            </span>
            <button
              onClick={() => {
                if (historyIndex >= 0 && historyIndex < history.length - 1) {
                  restoreHistory(historyIndex + 1);
                }
              }}
              disabled={historyIndex < 0 || historyIndex >= history.length - 1}
              style={{
                background: 'none',
                border: 'none',
                cursor: (historyIndex < 0 || historyIndex >= history.length - 1) ? 'default' : 'pointer',
                opacity: (historyIndex < 0 || historyIndex >= history.length - 1) ? 0.15 : 0.5,
                fontSize: '16px',
                color: '#1a3a2a',
                padding: '0 4px',
              }}
            >
              &gt;
            </button>

            {/* RLHF: Thumbs up / down */}
            {(() => {
              const idx = historyIndex >= 0 ? historyIndex : history.length - 1;
              const fid = idx >= 0 && idx < history.length ? history[idx].feedbackId : null;
              const currentRating = fid ? (feedbackRatings.get(fid) ?? 0) : 0;
              if (!fid) return null;
              return (
                <div style={{ display: 'flex', gap: '2px', marginLeft: '8px' }}>
                  <button
                    onClick={() => handleRate(1)}
                    title="Good generation"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '0 2px',
                      opacity: currentRating === 1 ? 1 : 0.25,
                      color: '#1a3a2a',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={currentRating === 1 ? '#1a3a2a' : 'none'} stroke="#1a3a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
                      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleRate(-1)}
                    title="Bad generation"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '0 2px',
                      opacity: currentRating === -1 ? 1 : 0.25,
                      color: '#8b0000',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={currentRating === -1 ? '#8b0000' : 'none'} stroke="#8b0000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
                      <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                    </svg>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: '6px 14px 10px', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={target === 'script' ? 'make a rainstorm...' : target === 'sample' ? 'a warm pad sound...' : 'a bird that stops on branches...'}
          rows={2}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid #d0cdc4',
            borderRadius: 12,
            fontSize: '16px',
            fontFamily: "'Inter', system-ui, sans-serif",
            background: '#faf9f6',
            outline: 'none',
            resize: 'none',
            color: '#1a3a2a',
            lineHeight: 1.4,
          }}
        />
        {/* Push-to-talk mic button */}
        <button
          onMouseDown={asr.start}
          onMouseUp={asr.stop}
          onMouseLeave={asr.recording ? asr.stop : undefined}
          title={asr.recording ? 'Release to transcribe' : asr.transcribing ? 'Transcribing...' : 'Hold to speak'}
          disabled={isLoading || asr.transcribing}
          style={{
            width: 34,
            height: 34,
            background: asr.recording ? '#8b0000' : 'none',
            border: `1.5px solid ${asr.recording ? '#8b0000' : '#d0cdc4'}`,
            borderRadius: 10,
            cursor: isLoading || asr.transcribing ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: isLoading || asr.transcribing ? 0.3 : asr.recording ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={asr.recording ? '#faf9f6' : '#1a3a2a'} strokeWidth="1.3">
            <rect x="5" y="1" width="4" height="8" rx="2" strokeLinejoin="round"/>
            <path d="M3 7 C3 9.2 4.8 11 7 11 C9.2 11 11 9.2 11 7" strokeLinecap="round"/>
            <line x1="7" y1="11" x2="7" y2="13" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
