import { useState, useEffect, useCallback, useRef } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  /** When false, skip the onboarding steps and only show the logo splash */
  showTutorial?: boolean;
}

// ─── Sound design ───────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Warm sine tone with slow attack — like a room opening up */
function playTone(freq: number, volume: number, attack: number, decay: number, delay = 0) {
  const c = ctx();
  const t = c.currentTime + delay;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);

  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + attack + decay + 0.1);
}

/** Logo reveal — soft C major chord that swells in, spatially warm */
function soundLogoReveal() {
  // C4 fundamental — warm and grounded
  playTone(262, 0.06, 1.2, 2.5, 0);
  // E4 third — enters slightly later, creates warmth
  playTone(330, 0.035, 1.0, 2.0, 0.4);
  // G4 fifth — barely there, adds air
  playTone(392, 0.015, 0.8, 1.5, 0.8);
}

/** Step transition — a single soft pitched tone, ascending per step */
const STEP_NOTES = [262, 330, 392]; // C4, E4, G4
function soundStepAdvance(step: number) {
  const freq = STEP_NOTES[step] ?? 440;
  playTone(freq, 0.04, 0.05, 0.4, 0);
}

/** Exit — gentle falling interval, like a soft exhale */
function soundExit() {
  playTone(392, 0.03, 0.04, 0.6, 0);  // G4
  playTone(262, 0.025, 0.04, 0.8, 0.1); // C4
}

/** Button hover — tiny high sine blip, barely audible */
function soundHover() {
  playTone(1800, 0.008, 0.01, 0.06, 0);
}

/** Button click — short soft mid-range tap */
function soundClick() {
  playTone(600, 0.025, 0.015, 0.12, 0);
}

// ─── Sparse floating dust motes ─────────────────────────────────────────────

function DustField({ fading }: { fading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const timeRef = useRef(0);
  const dotsRef = useRef(
    Array.from({ length: 18 }, (_, i) => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 0.8 + Math.random() * 1.2,
      speed: 0.1 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.06 + Math.random() * 0.12,
    }))
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext('2d');
    if (!c) return;

    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      if (!running) return;
      const dpr = window.devicePixelRatio;
      const w = canvas.width;
      const h = canvas.height;
      timeRef.current += 0.004;
      const t = timeRef.current;

      c.clearRect(0, 0, w, h);

      for (const dot of dotsRef.current) {
        dot.x += Math.sin(dot.phase + t) * dot.speed * 0.015;
        dot.y -= dot.speed * 0.008;
        if (dot.y < -2) { dot.y = 102; dot.x = Math.random() * 100; }
        if (dot.x < -2) dot.x = 102;
        if (dot.x > 102) dot.x = -2;

        const px = (dot.x / 100) * w;
        const py = (dot.y / 100) * h;
        const r = dot.size * dpr;

        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fillStyle = `rgba(244, 243, 238, ${dot.opacity})`;
        c.fill();
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        opacity: fading ? 0 : 1,
        transition: 'opacity 1.2s ease-out',
      }}
    />
  );
}

// ─── Onboarding content ─────────────────────────────────────────────────────

const STEPS = [
  {
    title: 'Write sound in space',
    body: 'A plaintext language for spatial audio. Position voices in 3D, shape them with effects, watch them move.',
  },
  {
    title: 'Trajectories',
    body: 'Spiral, orbit, Lorenz — sounds follow paths through space. Define motion in your script or generate it with AI.',
  },
  {
    title: 'Effects & mixing',
    body: 'Filter, reverb, delay, distortion, EQ. All native Web Audio, all controllable per voice, all in real time.',
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function SplashScreen({ onComplete, showTutorial = true }: SplashScreenProps) {
  // 0 = logo-in, 1 = logo-hold, 2 = onboarding steps, 3 = fade-out
  const [phase, setPhase] = useState(0);
  const [step, setStep] = useState(0);
  const [stepAnim, setStepAnim] = useState<'in' | 'out'>('in');
  const [logoVisible, setLogoVisible] = useState(false);

  // Logo timeline
  useEffect(() => {
    const t0 = setTimeout(() => {
      setLogoVisible(true);
      soundLogoReveal();
    }, 300);
    const t1 = setTimeout(() => setPhase(1), 1800);
    if (showTutorial) {
      // Show onboarding steps after logo
      const t2 = setTimeout(() => setPhase(2), 3200);
      return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
    } else {
      // Skip tutorial — fade out after logo hold
      const t2 = setTimeout(() => {
        setPhase(3);
        setTimeout(onComplete, 900);
      }, 3200);
      return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
    }
  }, []);

  // Play step sound when entering onboarding
  useEffect(() => {
    if (phase === 2 && stepAnim === 'in') {
      soundStepAdvance(step);
    }
  }, [phase, step, stepAnim]);

  const goNext = useCallback(() => {
    if (phase === 2 && step < STEPS.length - 1) {
      setStepAnim('out');
      setTimeout(() => {
        setStep(s => s + 1);
        setStepAnim('in');
      }, 250);
    } else {
      soundExit();
      setPhase(3);
      setTimeout(onComplete, 900);
    }
  }, [phase, step, onComplete]);

  const skip = useCallback(() => {
    soundExit();
    setPhase(3);
    setTimeout(onComplete, 900);
  }, [onComplete]);

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (phase < 2) {
          setPhase(2);
          setLogoVisible(true);
        } else if (phase === 2) {
          goNext();
        }
      } else if (e.key === 'Escape') {
        skip();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [phase, goNext, skip]);

  const currentStep = STEPS[step];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: phase === 3 ? 0 : 1,
      transition: 'opacity 0.9s ease-out',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      overflow: 'hidden',
    }}>

      <DustField fading={phase === 3} />

      {/* ── Logo ── */}
      <div style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0px',
        opacity: phase <= 1 ? 1 : 0,
        transform: phase >= 2 ? 'translateY(-20px)' : 'translateY(0)',
        transition: 'opacity 0.8s ease-out, transform 0.8s ease-out',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', userSelect: 'none' }}>
          {'satie'.split('').map((ch, i) => (
            <span
              key={i}
              style={{
                fontSize: 'clamp(48px, 10vw, 120px)',
                fontWeight: 300,
                color: '#f4f3ee',
                letterSpacing: '0.08em',
                opacity: logoVisible ? 1 : 0,
                transform: logoVisible ? 'translateY(0)' : 'translateY(30px)',
                transition: `opacity 0.9s ease-out ${i * 0.08}s, transform 0.9s ease-out ${i * 0.08}s`,
              }}
            >
              {ch}
            </span>
          ))}
        </div>

      </div>

      {/* ── Onboarding ── */}
      <div style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: phase === 2 ? 1 : 0,
        transform: phase === 2 ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 0.6s ease-out 0.15s, transform 0.6s ease-out 0.15s',
        pointerEvents: phase === 2 ? 'auto' : 'none',
        maxWidth: '420px',
        padding: '0 32px',
        textAlign: 'center',
      }}>
        {/* Step content */}
        <div style={{
          opacity: stepAnim === 'in' ? 1 : 0,
          transform: stepAnim === 'in' ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
          marginBottom: '40px',
        }}>
          <div style={{
            fontSize: 'clamp(20px, 3vw, 28px)',
            fontWeight: 300,
            color: '#f4f3ee',
            marginBottom: '14px',
            letterSpacing: '0.01em',
          }}>
            {currentStep.title}
          </div>
          <div style={{
            fontSize: '15px',
            fontWeight: 300,
            color: '#f4f3ee',
            opacity: 0.35,
            lineHeight: 1.7,
          }}>
            {currentStep.body}
          </div>
        </div>

        {/* Dots */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '36px' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 18 : 4,
                height: 4,
                borderRadius: 2,
                background: '#f4f3ee',
                opacity: i === step ? 0.4 : 0.1,
                transition: 'all 0.3s ease-out',
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button
            onClick={() => { soundClick(); skip(); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#f4f3ee',
              fontSize: '16px',
              fontWeight: 400,
              cursor: 'pointer',
              fontFamily: "'Inter', system-ui, sans-serif",
              opacity: 0.2,
              padding: '8px 4px',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => { soundHover(); e.currentTarget.style.opacity = '0.5'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.2'; }}
          >
            skip
          </button>
          <button
            onClick={() => { soundClick(); goNext(); }}
            style={{
              background: 'none',
              border: '1px solid rgba(244, 243, 238, 0.15)',
              borderRadius: 8,
              padding: '8px 24px',
              color: '#f4f3ee',
              fontSize: '16px',
              fontWeight: 400,
              cursor: 'pointer',
              fontFamily: "'Inter', system-ui, sans-serif",
              letterSpacing: '0.02em',
              transition: 'border-color 0.2s, opacity 0.2s',
              opacity: 0.5,
            }}
            onMouseEnter={e => { soundHover(); e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.borderColor = 'rgba(244,243,238,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.borderColor = 'rgba(244,243,238,0.15)'; }}
          >
            {step < STEPS.length - 1 ? 'next' : 'begin'}
          </button>
        </div>
      </div>

      {/* Bottom hint */}
      {phase === 2 && (
        <div style={{
          position: 'absolute',
          bottom: 28,
          fontSize: '15px',
          color: '#f4f3ee',
          opacity: 0.1,
          letterSpacing: '0.04em',
        }}>
          enter to continue
        </div>
      )}
    </div>
  );
}
