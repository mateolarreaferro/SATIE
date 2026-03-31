/**
 * Template compositions for onboarding.
 * Each template demonstrates a key feature of the Satie DSL.
 */

export interface Template {
  title: string;
  description: string;
  script: string;
}

export const TEMPLATES: Template[] = [
  {
    title: 'Spatial Rain',
    description: 'Moving rain with reverb and volume fade',
    script: `- Spatial rain with reverb

loop gen "gentle rain on leaves"
  volume fade 0 0.6 every 4
  move fly -8 -2 -8 8 2 8
  speed 0.2
  noise 0.4
  reverb 0.5 0.8 0.6
  fade_in 3
  visual trail sphere
  color #4a8a6a
`,
  },
  {
    title: 'Rhythmic Pulse',
    description: 'Repeating oneshots with filter sweep',
    script: `- Rhythmic pulse with filter automation

oneshot gen "short percussive click" every 0.5
  volume 0.7
  move fixed 0 0 -3
  filter lowpass cutoff fade 200 4000 every 4 loop bounce
  distortion softclip drive 2 wet 0.3
  visual cube size 1.5
  color #8b0000

oneshot gen "deep bass thump" every 2
  volume 0.5
  move fixed 0 -1 0
  reverb 0.3 0.5 0.4
  visual sphere size 2
  color #2b2b8a
`,
  },
  {
    title: 'Drone Landscape',
    description: 'Layered drones with pitch modulation',
    script: `- Layered drone landscape

group
  reverb 0.6 0.9 0.5
  move fly -10 -3 -10 10 3 10
  speed 0.1
  visual trail
  fade_in 5

  loop gen "deep warm drone"
    volume 0.4
    pitch fade 0.8 1.2 every 8 loop bounce
    color #1a3a2a

  loop gen "high ethereal shimmer"
    volume 0.25
    pitch fade 1.5 2.0 every 12 loop bounce
    color #6a8a9a

  loop gen "mid-range humming tone"
    volume 0.3
    pitch 0.6
    color #8a6a3a
endgroup
`,
  },
  {
    title: 'Spatial Orchestra',
    description: 'Multiple voices positioned in 3D space',
    script: `- Spatial positioning demo

loop gen "soft violin sustain"
  volume 0.5
  move fixed -4 0 -2
  reverb 0.4 0.6 0.5
  visual sphere
  color #8b4513

loop gen "cello low drone"
  volume 0.4
  move fixed 4 0 -2
  reverb 0.4 0.6 0.5
  visual sphere
  color #4a2a1a

loop gen "gentle wind chimes"
  volume 0.3
  move fly -3 2 -5 3 4 5
  speed 0.3
  noise 0.5
  delay 0.4 0.3 0.5
  visual trail sphere
  color #6a9aba

oneshot gen "distant thunder rumble" every 8to15
  volume fade 0 0.5 every 3
  move fly -10 -1 -10 10 1 10
  reverb 0.7 0.95 0.3
  visual cube size 3
  color #3a3a4a
  alpha 0.4
`,
  },
  {
    title: 'Generative Rhythm',
    description: 'Randomized timing and pitch for organic patterns',
    script: `- Generative rhythm with randomized parameters

3 * oneshot gen "wooden percussion tap" every 0.3to0.8
  volume 0.4to0.7
  pitch 0.8to1.4
  move walk -5 -5 5 5
  speed 0.5
  visual cube
  color #8b6914
  randomstart

2 * oneshot gen "metallic ping" every 1to3
  volume 0.2to0.4
  pitch 1.5to3.0
  move fly -3 1 -3 3 3 3
  speed 0.8
  delay 0.3 0.15 0.4 pingpong
  visual sphere size 0.5
  color #4a7a8a

loop gen "low ambient pad"
  volume 0.25
  pitch 0.5
  move fixed 0 -2 0
  reverb 0.6 0.9 0.7
  filter lowpass cutoff 800 resonance 1
  fade_in 4
  visual trail
  color #2a2a4a
  alpha 0.3
`,
  },
];
