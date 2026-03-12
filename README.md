# Satie

Spatial audio composition in the browser. Write text, hear it in 3D.

## Install

```
git clone <repo-url> && cd SATIE
npm install
```

Create a `.env` file (optional, only needed for cloud features):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run the dev server:

```
npm run dev
```

Build for production:

```
npm run build
```

## Syntax

A Satie script is a list of **statements**. Each statement triggers one or more sound voices with spatial, visual, and DSP properties.

### Statements

```
loop clip.wav every 2
```

Play `clip.wav` on loop, repeating every 2 seconds.

```
oneshot hit.wav
```

Play `hit.wav` once.

```
3* loop clip.wav every 1to3
```

Spawn 3 independent voices, each repeating at a random interval between 1 and 3 seconds.

### Properties

Properties are indented lines below a statement. Values are space-separated (no `=`).

```
loop rain.wav every 4
  volume 0.6
  pitch 0.8to1.2
  start 0.5
  duration 3
  fade_in 1
  fade_out 2
```

| Property | Description | Example |
| --- | --- | --- |
| `volume` | Amplitude 0-1 (or range) | `0.5`, `0.3to0.8` |
| `pitch` | Playback rate | `1.0`, `0.5to2.0` |
| `start` | Start offset in seconds | `0`, `0to5` |
| `end` | End time in seconds | `10`, `10 fade 2` |
| `duration` | Playback duration | `5`, `2to8` |
| `every` | Re-trigger interval | `2`, `1to4` |
| `fade_in` | Fade in duration (seconds) | `1` |
| `fade_out` | Fade out duration (seconds) | `2` |
| `overlap` | Allow voices to overlap | (flag, no value) |
| `persistent` | Voice stays alive between re-evaluations | (flag) |
| `mute` | Mute this voice | (flag) |
| `solo` | Solo this voice | (flag) |
| `randomstart` | Start at a random position in the file | (flag) |

### Ranges

Anywhere a number is expected, you can write a range:

```
volume 0.3to0.8
every 1to4
pitch 0.9to1.1
```

Each spawned voice samples a random value from the range.

### Interpolation

Animate any numeric property over time:

```
volume goto(0.8 in 5)
```

Fade volume to 0.8 over 5 seconds.

```
volume gobetween(0and1 in 10)
```

Oscillate volume between 0 and 1 over 10 seconds, forever.

```
pitch gobetween(0.5and2.0 as incubic in 8)
```

Add an easing curve. Available easings: `linear`, `inquad`, `outquad`, `inoutquad`, `incubic`, `outcubic`, `inoutcubic`, `inexpo`, `outexpo`, `inoutexpo`, `inelastic`, `outelastic`.

### Spatial Movement

Control where voices exist in 3D space.

```
loop wind.wav every 3
  move fly x -10to10 y 0to5 z -10to10 speed 2
```

| Move type | Description |
| --- | --- |
| `move walk` | Wander on the ground plane (y=0) |
| `move fly` | Wander in 3D space |
| `move fly x -5to5 y 0to3 z -5to5 speed 2` | Fly with custom bounds and speed |
| `move walk x -10to10 z -10to10 speed 0.5` | Walk with custom bounds |
| `move orbit` | Follow an orbital trajectory |
| `move spiral` | Follow a spiral trajectory |
| `move lorenz` | Follow a Lorenz attractor |

Trajectories accept optional `speed`, `noise`, and axis bounds:

```
move orbit speed 0.5 noise 0.2 x -3to3 y -1to1 z -3to3
```

### Visual

Control the appearance of voice nodes in the 3D viewport.

```
loop pad.wav every 5
  color #FF4500
  alpha 0.7
  visual trail
```

Colors accept hex (`#FF4500`), RGB (`255,69,0`), named colors (`red`, `cyan`, `white`), or per-channel control:

```
color red 200to255 green 0to50 blue gobetween(0and255 as inquad in 4)
```

Animate between two hex colors:

```
color gobetween(#000000to#FFFFFF in 10)
```

### DSP Effects

Add audio effects inline as properties.

**Reverb:**
```
reverb wet 0.5 size 0.8 damping 0.3
```

**Delay:**
```
delay wet 0.4 time 0.375 feedback 0.6
```

**Filter:**
```
filter mode lowpass cutoff 800 resonance 4
```

Filter modes: `lowpass`, `highpass`, `bandpass`, `notch`, `peak`.

**Distortion:**
```
distortion mode softclip drive 3 wet 0.5
```

Distortion modes: `softclip`, `hardclip`, `tanh`, `cubic`, `asymmetric`.

**EQ:**
```
eq low 6 mid -3 high 2
```

All DSP parameters support interpolation:

```
filter mode lowpass cutoff gobetween(200and4000 as inoutcubic in 8)
```

### Groups

Apply shared properties to multiple statements:

```
group
  volume 0.3
  move fly x -5to5 y 0to3 z -5to5

  loop rain.wav every 2
  loop thunder.wav every 8to15
  oneshot lightning.wav
endgroup
```

Children inherit group properties but can override them.

### Comments

```
# inline comment

comment
  this is a block comment
  spanning multiple lines
endcomment
```

### Audio Generation

Generate audio on the fly (requires an ElevenLabs API key in settings).

Define a gen block with generation parameters, then reference it like any clip:

```
gen myWind
  prompt ethereal wind sound
  duration 5
  influence 0.7
  loopable

loop myWind every 4
  volume 0.5
```

You can also use the inline shorthand for quick one-offs:

```
loop gen ethereal wind sound every 4
```

Gen block properties:

| Property | Description | Default |
| --- | --- | --- |
| `prompt` | Text description of the sound (required) | — |
| `duration` | Length in seconds (0.5-22) | auto |
| `influence` | How closely to follow the prompt (0-1) | auto |
| `loopable` | Make the sound seamlessly loopable | off |

### Full Example

```
# a rainy forest

3* loop rain.wav every 2to5
  volume 0.2to0.4
  move fly x -15to15 y 1to8 z -15to15 speed 0.3
  reverb wet 0.6 size 0.9
  color #4477AA
  alpha 0.3

loop thunder.wav every 10to30
  volume 0.5to0.8
  pitch 0.6to0.9
  move fly x -20to20 y 5to15 z -20to20
  filter mode lowpass cutoff 600
  color #FFFFFF
  alpha gobetween(0.2and1.0 in 3)

5* loop bird.wav every 3to8
  volume 0.1to0.3
  pitch 0.8to1.4
  move orbit speed 0.5 x -10to10 y 2to6 z -10to10
  delay wet 0.2 time 0.25 feedback 0.3
  color red 50to100 green 200to255 blue 50to100
  randomstart
```
