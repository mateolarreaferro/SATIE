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

3 * loop gen gentle rain on leaves
  volume fade 0 1 every 4
  move fly speed 0.2 noise 0.4
  reverb 0.5 0.8 0.6
  visual trail
  color #4a8a6a
`,
  },
  {
    title: 'Rhythmic Pulse',
    description: 'Repeating oneshots with filter sweep',
    script: `- Rhythmic pulse with filter automation

3 * oneshot gen short percussive click every 0.1to0.5
  move walk
  visual cube size 1.5
  color #8b0000

5 * oneshot gen deep bass thump every 0.5to2
  move fly
  visual sphere
  color #2b2b8a
`,
  },
  {
    title: 'Drone Landscape',
    description: 'Layered drones with pitch modulation',
    script: `- Layered drone landscape

group sounds
pitch 0.5
volume fade 0 1 every 10

  loop gen deep warm drone
    volume 0.4
    pitch jump 0.8 1.2 1.6 2 every 8 loop bounce
    move fly speed 0.5
    visual trail
    color #00ff80ff

  loop gen high ethereal shimmer
    volume 0.25
    pitch fade 1.5 2.0 every 12 loop bounce
    move walk speed 0.5
    visual trail
    color #6a8a9a

  loop gen mid-range humming tone
    volume 0.3
    pitch 0.6
    move walk speed 0.3
    visual trail
    color #8a6a3a
`,
  },
];
