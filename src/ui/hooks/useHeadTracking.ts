import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Head tracking via DeviceOrientation API.
 * Maps device rotation to listener orientation for binaural audio.
 *
 * Returns:
 * - enabled: current state
 * - available: whether the API is supported
 * - toggle: function to enable/disable
 * - orientation: current Euler angles { alpha, beta, gamma }
 */
export function useHeadTracking(
  onOrientationChange?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void,
) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const callbackRef = useRef(onOrientationChange);
  callbackRef.current = onOrientationChange;

  // Check availability
  useEffect(() => {
    setAvailable('DeviceOrientationEvent' in window);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;

      const alpha = (e.alpha * Math.PI) / 180; // yaw (compass heading)
      const beta = (e.beta * Math.PI) / 180;   // pitch (tilt front-back)
      const gamma = (e.gamma * Math.PI) / 180;  // roll (tilt left-right)

      // Convert device orientation to forward and up vectors
      // Forward vector (where the user is "looking")
      const fx = -Math.sin(alpha) * Math.cos(beta);
      const fy = Math.sin(beta);
      const fz = -Math.cos(alpha) * Math.cos(beta);

      // Up vector
      const ux = Math.sin(gamma) * Math.cos(alpha) - Math.cos(gamma) * Math.sin(beta) * Math.sin(alpha);
      const uy = Math.cos(gamma) * Math.cos(beta);
      const uz = -Math.sin(gamma) * Math.sin(alpha) - Math.cos(gamma) * Math.sin(beta) * Math.cos(alpha);

      callbackRef.current?.(fx, fy, fz, ux, uy, uz);
    };

    // Request permission on iOS 13+
    const DeviceOrientationEventTyped = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };

    if (DeviceOrientationEventTyped.requestPermission) {
      DeviceOrientationEventTyped.requestPermission()
        .then((permission) => {
          if (permission === 'granted') {
            window.addEventListener('deviceorientation', handler);
          } else {
            setEnabled(false);
          }
        })
        .catch(() => setEnabled(false));
    } else {
      window.addEventListener('deviceorientation', handler);
    }

    return () => {
      window.removeEventListener('deviceorientation', handler);
    };
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

  return { enabled, available, toggle };
}
