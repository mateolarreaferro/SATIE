/**
 * Maps audio/sound descriptions to Phosphor icon names.
 * Used to resolve semantic icons for voice visualization in the 3D viewport.
 *
 * Two resolution strategies:
 * 1. Exact match: statement.icon field (set by AI or DSL)
 * 2. Keyword match: scan clip name / genPrompt for keywords
 */

// ── Available icon names (must match filenames in @phosphor-icons/core/assets/light/) ──

export const ICON_NAMES = [
  'lightning', 'bird', 'fire', 'wind', 'cloud-rain', 'cloud-snow',
  'cloud-lightning', 'waves', 'drop', 'sun', 'moon', 'star', 'campfire',
  'tree', 'leaf', 'flower', 'mountains', 'flame', 'meteor', 'planet',
  'globe', 'tent', 'city', 'buildings', 'factory', 'siren', 'bell',
  'guitar', 'piano-keys', 'music-note', 'music-notes', 'vinyl-record',
  'speaker-high', 'microphone-stage', 'waveform', 'radio', 'dog', 'cat',
  'fish', 'horse', 'butterfly', 'paw-print', 'person-simple-walk',
  'footprints', 'car', 'train', 'boat', 'rocket', 'robot', 'alien',
  'ghost', 'skull', 'heartbeat', 'brain', 'eye', 'clock', 'gear', 'bomb',
  'snowflake', 'rainbow', 'wave-sine', 'church', 'sword', 'shield',
  'diamond', 'crown',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_NAME_SET = new Set<string>(ICON_NAMES);

export function isValidIcon(name: string): name is IconName {
  return ICON_NAME_SET.has(name);
}

// ── Keyword → icon mapping ──────────────────────────────────

interface KeywordEntry {
  keywords: string[];
  icon: IconName;
}

/**
 * Ordered by specificity — first match wins.
 * Multi-word keywords are checked as substrings; single words as whole-token matches.
 */
const KEYWORD_MAP: KeywordEntry[] = [
  // Weather / atmosphere
  { keywords: ['thunder', 'thunderstorm'], icon: 'cloud-lightning' },
  { keywords: ['lightning', 'electric shock', 'zap'], icon: 'lightning' },
  { keywords: ['rain', 'drizzle', 'downpour', 'rainfall', 'raindrop'], icon: 'cloud-rain' },
  { keywords: ['snow', 'blizzard', 'sleet', 'hail'], icon: 'cloud-snow' },
  { keywords: ['snowflake', 'frost', 'ice', 'frozen', 'icicle'], icon: 'snowflake' },
  { keywords: ['wind', 'breeze', 'gust', 'howling', 'whoosh', 'air'], icon: 'wind' },
  { keywords: ['cloud', 'overcast', 'fog', 'mist', 'haze'], icon: 'cloud-rain' },
  { keywords: ['rainbow'], icon: 'rainbow' },
  { keywords: ['sun', 'sunshine', 'solar', 'dawn', 'sunrise', 'daylight'], icon: 'sun' },
  { keywords: ['moon', 'lunar', 'moonlight', 'midnight', 'moonrise'], icon: 'moon' },
  { keywords: ['star', 'stellar', 'starry', 'twinkle', 'shimmer', 'sparkle'], icon: 'star' },
  { keywords: ['meteor', 'comet', 'asteroid', 'shooting star'], icon: 'meteor' },
  { keywords: ['planet', 'saturn', 'jupiter', 'mars', 'venus'], icon: 'planet' },
  { keywords: ['space', 'cosmos', 'cosmic', 'universe', 'galaxy', 'nebula'], icon: 'globe' },

  // Fire / heat
  { keywords: ['campfire', 'bonfire', 'fireplace', 'crackling fire', 'wood fire'], icon: 'campfire' },
  { keywords: ['fire', 'burning', 'inferno', 'blaze'], icon: 'fire' },
  { keywords: ['flame', 'torch', 'ember', 'smolder'], icon: 'flame' },

  // Water
  { keywords: ['ocean', 'sea', 'surf', 'tide', 'wave', 'coastal', 'shore', 'beach'], icon: 'waves' },
  { keywords: ['water', 'drip', 'splash', 'stream', 'creek', 'brook', 'river', 'waterfall', 'fountain'], icon: 'drop' },

  // Nature / landscape
  { keywords: ['mountain', 'canyon', 'cliff', 'valley', 'hill', 'peak', 'summit'], icon: 'mountains' },
  { keywords: ['tree', 'forest', 'woods', 'woodland', 'jungle', 'canopy'], icon: 'tree' },
  { keywords: ['leaf', 'leaves', 'foliage', 'rustling', 'rustle'], icon: 'leaf' },
  { keywords: ['flower', 'blossom', 'bloom', 'petal', 'garden'], icon: 'flower' },

  // Animals
  { keywords: ['bird', 'birdsong', 'chirp', 'tweet', 'robin', 'sparrow', 'crow', 'raven', 'hawk', 'eagle', 'owl', 'seagull', 'songbird', 'warbler', 'finch', 'cardinal', 'jay', 'pigeon', 'dove', 'parrot', 'cockatoo'], icon: 'bird' },
  { keywords: ['dog', 'bark', 'puppy', 'hound', 'canine', 'wolf', 'howl', 'coyote'], icon: 'dog' },
  { keywords: ['cat', 'meow', 'purr', 'kitten', 'feline'], icon: 'cat' },
  { keywords: ['fish', 'underwater', 'aquatic', 'bubbles', 'submarine'], icon: 'fish' },
  { keywords: ['horse', 'gallop', 'trot', 'neigh', 'hoof', 'hooves', 'stallion'], icon: 'horse' },
  { keywords: ['butterfly', 'moth', 'flutter'], icon: 'butterfly' },
  { keywords: ['insect', 'cricket', 'cicada', 'bee', 'buzz', 'mosquito', 'fly'], icon: 'butterfly' },
  { keywords: ['frog', 'toad', 'croak', 'ribbit', 'amphibian'], icon: 'paw-print' },
  { keywords: ['animal', 'creature', 'beast', 'wildlife', 'paw'], icon: 'paw-print' },

  // Music / instruments
  { keywords: ['guitar', 'acoustic', 'strum', 'pluck', 'banjo', 'ukulele', 'mandolin'], icon: 'guitar' },
  { keywords: ['piano', 'keyboard', 'keys', 'harpsichord', 'organ'], icon: 'piano-keys' },
  { keywords: ['drum', 'percussion', 'snare', 'kick', 'hi-hat', 'cymbal', 'timpani', 'bongo', 'conga', 'tabla', 'djembe'], icon: 'music-notes' },
  { keywords: ['bell', 'chime', 'gong', 'ring', 'ding', 'toll', 'jingle', 'carillon'], icon: 'bell' },
  { keywords: ['trumpet', 'horn', 'tuba', 'trombone', 'brass', 'bugle', 'fanfare'], icon: 'music-note' },
  { keywords: ['violin', 'cello', 'viola', 'strings', 'fiddle', 'bow', 'orchestra'], icon: 'music-note' },
  { keywords: ['flute', 'oboe', 'clarinet', 'saxophone', 'sax', 'woodwind', 'bassoon', 'piccolo', 'recorder', 'pan flute'], icon: 'music-note' },
  { keywords: ['synth', 'synthesizer', 'electronic', 'analog', 'modular'], icon: 'wave-sine' },
  { keywords: ['vinyl', 'record', 'turntable', 'phonograph', 'gramophone'], icon: 'vinyl-record' },
  { keywords: ['radio', 'broadcast', 'static', 'tuning', 'frequency', 'transmission'], icon: 'radio' },
  { keywords: ['music', 'melody', 'song', 'tune', 'harmony', 'chord', 'rhythm'], icon: 'music-notes' },

  // Voice / speech
  { keywords: ['voice', 'vocal', 'sing', 'singing', 'choir', 'chant', 'hymn', 'whisper', 'murmur', 'speech', 'talk', 'speak', 'narrat', 'scream', 'shout', 'yell', 'cry', 'moan', 'groan', 'laugh', 'giggle', 'hum'], icon: 'microphone-stage' },

  // Human / body
  { keywords: ['footstep', 'walking', 'step', 'pace'], icon: 'footprints' },
  { keywords: ['person', 'human', 'people', 'crowd', 'pedestrian'], icon: 'person-simple-walk' },
  { keywords: ['heartbeat', 'heart', 'pulse', 'cardiac', 'thump'], icon: 'heartbeat' },
  { keywords: ['breath', 'breathing', 'exhale', 'inhale', 'sigh', 'gasp'], icon: 'wind' },

  // Urban / machines
  { keywords: ['city', 'urban', 'downtown', 'traffic', 'street', 'road', 'highway', 'crosswalk'], icon: 'city' },
  { keywords: ['building', 'office', 'room', 'indoor', 'interior', 'hall', 'corridor', 'warehouse'], icon: 'buildings' },
  { keywords: ['factory', 'industrial', 'machine', 'mechanical', 'engine', 'motor', 'turbine', 'generator'], icon: 'factory' },
  { keywords: ['siren', 'alarm', 'emergency', 'police', 'ambulance', 'firetruck'], icon: 'siren' },
  { keywords: ['car', 'vehicle', 'drive', 'automobile', 'truck', 'bus'], icon: 'car' },
  { keywords: ['train', 'railway', 'rail', 'locomotive', 'subway', 'metro'], icon: 'train' },
  { keywords: ['boat', 'ship', 'sail', 'harbor', 'port', 'yacht', 'ferry', 'anchor'], icon: 'boat' },
  { keywords: ['church', 'cathedral', 'chapel', 'temple', 'mosque', 'monastery', 'prayer'], icon: 'church' },
  { keywords: ['clock', 'tick', 'tock', 'timer', 'metronome'], icon: 'clock' },

  // Sci-fi / fantasy
  { keywords: ['rocket', 'spaceship', 'launch', 'liftoff', 'thruster'], icon: 'rocket' },
  { keywords: ['robot', 'android', 'cyborg', 'mechanical', 'servo', 'robotic'], icon: 'robot' },
  { keywords: ['alien', 'extraterrestrial', 'ufo', 'spaceship'], icon: 'alien' },
  { keywords: ['ghost', 'haunt', 'spooky', 'eerie', 'phantom', 'specter', 'poltergeist'], icon: 'ghost' },
  { keywords: ['skull', 'skeleton', 'bone', 'death', 'dead'], icon: 'skull' },

  // Abstract / misc
  { keywords: ['explosion', 'blast', 'detonate', 'boom', 'bang', 'kaboom', 'impact', 'crash'], icon: 'bomb' },
  { keywords: ['brain', 'mind', 'thought', 'think', 'mental', 'psyche'], icon: 'brain' },
  { keywords: ['eye', 'gaze', 'stare', 'vision', 'sight', 'blink'], icon: 'eye' },
  { keywords: ['gear', 'cog', 'mechanism', 'apparatus'], icon: 'gear' },
  { keywords: ['sword', 'blade', 'slash', 'cut', 'slice', 'combat', 'fight', 'battle', 'clash', 'clang'], icon: 'sword' },
  { keywords: ['shield', 'defend', 'block', 'armor', 'armour', 'protect'], icon: 'shield' },
  { keywords: ['crown', 'king', 'queen', 'royal', 'regal', 'majestic', 'throne'], icon: 'crown' },
  { keywords: ['diamond', 'gem', 'jewel', 'crystal', 'crystalline', 'glass', 'shatter'], icon: 'diamond' },

  // Camping / outdoor
  { keywords: ['tent', 'camp', 'camping', 'outdoor', 'wilderness', 'nature'], icon: 'tent' },
];

/**
 * Resolve an icon name from a text description (clip name, genPrompt, etc.).
 * Returns null if no match found — caller should fall back to default visual.
 */
export function resolveIconFromText(text: string): IconName | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    for (const kw of entry.keywords) {
      if (kw.includes(' ')) {
        // Multi-word: substring match
        if (lower.includes(kw)) return entry.icon;
      } else {
        // Single word: check as substring (handles compound words like "thunderstorm")
        if (lower.includes(kw)) return entry.icon;
      }
    }
  }

  return null;
}

/**
 * Resolve icon from visual tokens in the `visual` array.
 * Tokens like 'sphere', 'cube', 'trail', 'none', 'size', 'object:*' are standard
 * visual tokens — everything else is treated as an icon hint.
 */
const STANDARD_VISUAL_TOKENS = new Set(['sphere', 'cube', 'trail', 'none', 'size']);

function resolveIconFromVisualTokens(visual: string[]): IconName | null {
  for (const token of visual) {
    if (STANDARD_VISUAL_TOKENS.has(token)) continue;
    if (token.startsWith('object:')) continue;
    if (/^\d/.test(token)) continue; // size value like "2"

    // Direct match — token IS an icon name (e.g. `visual lightning`)
    if (isValidIcon(token)) return token;

    // Keyword match — token maps to an icon (e.g. `visual cloud` → cloud-rain)
    const fromKeyword = resolveIconFromText(token);
    if (fromKeyword) return fromKeyword;
  }
  return null;
}

/**
 * Resolve the best icon for a track, checking multiple sources in priority order:
 * 1. Visual tokens (e.g. `visual cloud trail` → cloud icon)
 * 2. genPrompt (AI-generated sounds have descriptive prompts)
 * 3. Clip name (file path-derived name)
 */
export function resolveTrackIcon(statement: {
  visual: string[];
  genPrompt?: string | null;
  clip: string;
}): IconName | null {
  // 1. From visual tokens
  const fromVisual = resolveIconFromVisualTokens(statement.visual);
  if (fromVisual) return fromVisual;

  // 2. From genPrompt
  if (statement.genPrompt) {
    const fromPrompt = resolveIconFromText(statement.genPrompt);
    if (fromPrompt) return fromPrompt;
  }

  // 3. From clip name
  const clipName = statement.clip.split('/').pop() ?? '';
  const cleaned = clipName.replace(/_\d+$/g, '').replace(/_/g, ' ');
  return resolveIconFromText(cleaned);
}
