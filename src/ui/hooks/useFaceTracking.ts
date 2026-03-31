import { useRef, useEffect, useCallback, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * Webcam face tracking for spatial audio listener control.
 * Tracks head yaw/pitch via MediaPipe FaceLandmarker and maps
 * to listener orientation vectors for Web Audio.
 */

let _landmarkerPromise: Promise<FaceLandmarker> | null = null;

function loadLandmarker(): Promise<FaceLandmarker> {
  if (_landmarkerPromise) return _landmarkerPromise;
  _landmarkerPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
  })();
  return _landmarkerPromise;
}

function estimateYawPitch(lm: { x: number; y: number; z: number }[]): { yaw: number; pitch: number } {
  // Key landmarks: nose tip (1), left ear tragion (234), right ear tragion (454)
  const nose = lm[1];
  const le = lm[234];
  const re = lm[454];
  if (!nose || !le || !re) return { yaw: 0, pitch: 0 };

  const midX = (le.x + re.x) / 2;
  const earW = Math.abs(le.x - re.x) || 0.1;
  // Webcam is mirrored: positive x-displacement = looking right in the image = looking left in world
  const yaw = ((nose.x - midX) / earW) * 1.8;

  const midY = (le.y + re.y) / 2;
  const pitch = (nose.y - midY) * 2.5;

  return { yaw, pitch };
}

/** Compact face mesh data for 3D rendering */
export interface FaceMeshData {
  /** 478 landmarks as flat [x,y,z, x,y,z, ...] in normalized 0-1 coords */
  positions: Float32Array;
  /** Current yaw angle (radians) */
  yaw: number;
  /** Current pitch angle (radians) */
  pitch: number;
}

export function useFaceTracking(
  onOrientationChange?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void,
) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Live face mesh data — read by Three.js in useFrame, no React re-renders */
  const meshRef = useRef<FaceMeshData | null>(null);
  const cbRef = useRef(onOrientationChange);
  cbRef.current = onOrientationChange;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lmRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const syaw = useRef(0);
  const spitch = useRef(0);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240, frameRate: 30 },
      });
      streamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(video);
      await video.play();
      videoRef.current = video;

      const lm = await loadLandmarker();
      lmRef.current = lm;

      setLoading(false);
      setEnabled(true);

      let last = 0;
      const step = 1000 / 15; // 15 fps

      const loop = () => {
        if (!videoRef.current || !lmRef.current) return;
        const now = performance.now();
        if (now - last >= step) {
          last = now;
          try {
            const res = lmRef.current.detectForVideo(videoRef.current, now);
            if (res.faceLandmarks?.[0]) {
              const lm = res.faceLandmarks[0];
              const { yaw, pitch } = estimateYawPitch(lm);
              syaw.current += (yaw - syaw.current) * 0.18;
              spitch.current += (pitch - spitch.current) * 0.18;

              const y = syaw.current;
              const p = spitch.current;
              const fx = -Math.sin(y) * Math.cos(p);
              const fy = -Math.sin(p);
              const fz = -Math.cos(y) * Math.cos(p);
              cbRef.current?.(fx, fy, fz, 0, Math.cos(p), 0);

              // Update face mesh data for 3D rendering
              const positions = meshRef.current?.positions ?? new Float32Array(lm.length * 3);
              for (let i = 0; i < lm.length; i++) {
                positions[i * 3] = lm[i].x;
                positions[i * 3 + 1] = lm[i].y;
                positions[i * 3 + 2] = lm[i].z;
              }
              meshRef.current = { positions, yaw: y, pitch: p };
            }
          } catch {
            // detection can throw on bad frames — skip
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      setLoading(false);
      setError(e.message || 'Camera access denied');
      _landmarkerPromise = null; // allow retry
    }
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    videoRef.current?.remove();
    videoRef.current = null;
    setEnabled(false);
    syaw.current = 0;
    spitch.current = 0;
  }, []);

  const toggle = useCallback(() => {
    if (enabled) stop(); else start();
  }, [enabled, start, stop]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    videoRef.current?.remove();
  }, []);

  return { enabled, loading, error, toggle, meshRef };
}
