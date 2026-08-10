/**
 * PES Soul — Babble Engine v4 (ЖИВОЙ ГОЛОС)
 * v3 → v4 changes:
 *   - Emotion blends (two emotions → hybrid sound)
 *   - Affinity tracking (imprint actually works — learns from praise)
 *   - Context-aware generation (time of day, silence duration, conversation flow)
 *   - Micro-expressions (tiny sounds between main phrases)
 *   - Breath patterns (pauses, inhales, sighs)
 *   - Idle variety (20+ unique idle babbles)
 *
 * Level gates:  0=tier0  2=combo  4=tier1  6=tier2  10=tier3  15=invention  20=advanced  40=crypto
 */

const CONSONANTS = ['г','р','м','х','ф','в','т','с','к','н','п','б','д','л','ш','ж'];
const VOWELS     = ['а','у','ы','о','и','е','э','ю'];
const NOISE      = ['3','7','0','z','q','x','ц','щ','~','.','-'];

const ANIMAL_SOUNDS = {
  tier0: ['гав','аф','мр','хм','рр','уу','ыы','хн'],
  tier1: ['тяф','ваф','рру','скс','мрр','вуф','ууу','ыыы','скууу'],
  tier2: ['мням','хрум','аууу','руу-руу','гяв','яп','хааа','пфф'],
  tier3: ['рррРРР','ыыыЫЫЫ','ГАВВВ','ААААА','вввуууф','скууу~'],
};
const ABSTRACT_SYMBOLS = ['◈','∿','≋','⟡','⊹','⟁','∞','◌','⊕','⑂'];
const INTENSITY_MARKS = {
  low: ['...','~','.','..'], mid: ['!','~','-',''],
  high: ['!!','!!!','!!','ВВ'], extreme: ['!!!!','!!!','АААА','!!!!'],
};

const EMOTION_INSTRUMENTS = {
  happy:           { tempo:'fast',  pitch:'high', pattern:'staccato', connector:'! ' },
  playful:         { tempo:'fast',  pitch:'high', pattern:'bounce',   connector:'-' },
  greeting_frenzy: { tempo:'burst', pitch:'high', pattern:'chaos',    connector:' ' },
  butt_wiggle:     { tempo:'fast',  pitch:'mid',  pattern:'wiggle',   connector:'~' },
  zoomies:         { tempo:'burst', pitch:'high', pattern:'repeat',   connector:'!!' },
  excited:         { tempo:'fast',  pitch:'high', pattern:'staccato', connector:'! ' },
  idle:            { tempo:'slow',  pitch:'low',  pattern:'smooth',   connector:'~ ' },
  content:         { tempo:'slow',  pitch:'mid',  pattern:'smooth',   connector:'~' },
  nap:             { tempo:'slow',  pitch:'low',  pattern:'fade',     connector:'...' },
  sleep:           { tempo:'slow',  pitch:'low',  pattern:'fade',     connector:'... ' },
  sad:             { tempo:'slow',  pitch:'low',  pattern:'descend',  connector:'.. ' },
  lonely:          { tempo:'slow',  pitch:'low',  pattern:'echo',     connector:'... ' },
  scared:          { tempo:'halt',  pitch:'low',  pattern:'stutter',  connector:'. ' },
  anxious:         { tempo:'mid',   pitch:'mid',  pattern:'stutter',  connector:'- ' },
  food_obsessed:   { tempo:'fast',  pitch:'mid',  pattern:'repeat',   connector:' ' },
  hungry:          { tempo:'mid',   pitch:'mid',  pattern:'repeat',   connector:'! ' },
  alert:           { tempo:'mid',   pitch:'high', pattern:'staccato', connector:'! ' },
  angry:           { tempo:'fast',  pitch:'high', pattern:'sharp',    connector:'!' },
  bark:            { tempo:'burst', pitch:'high', pattern:'sharp',    connector:'! ' },
  curious:         { tempo:'mid',   pitch:'mid',  pattern:'question', connector:'? ' },
  puzzle_solving:  { tempo:'slow',  pitch:'mid',  pattern:'question', connector:'.. ' },
  dramatic_tantrum:{ tempo:'burst', pitch:'high', pattern:'chaos',    connector:'!! ' },
  sulking:         { tempo:'halt',  pitch:'low',  pattern:'minimal',  connector:'. ' },
  stubborn_refuse: { tempo:'halt',  pitch:'mid',  pattern:'minimal',  connector:'.' },
};

const RHYTHM_PATTERNS = {
  staccato: a => { a[0]=a[0].toUpperCase(); if(a.length>2) a[a.length-1]=a[a.length-1].toUpperCase(); return a; },
  bounce:   a => a.map((x,i) => i%2===0 ? x : x.toLowerCase()),
  chaos:    a => a.map(x => x.toUpperCase()),
  smooth:   a => a.map(x => x.toLowerCase()),
  fade:     a => a.map((x,i) => i===0 ? x.toUpperCase() : i===a.length-1 ? x.toLowerCase()+'...' : x.toLowerCase()),
  descend:  a => a.map((x,i) => x.toLowerCase()+'.'.repeat(Math.min(i,3))),
  echo:     a => { const b=a[0]; return a.map((x,i) => i===0 ? x : b.toLowerCase()); },
  stutter:  a => a.map(x => x.length<=2 ? x+'-'+x : x.charAt(0)+'-'+x),
  question: a => a.map((x,i) => i===a.length-1 ? x+'?..' : x),
  repeat:   a => { if(a.length>=2) a[a.length-1]=a[0]; return a; },
  sharp:    a => a.map(x => x.length>3 ? x.slice(0,3).toUpperCase() : x.toUpperCase()),
  wiggle:   a => a.map(x => '~'+x+'~'),
  minimal:  a => a.slice(0, Math.max(1, Math.floor(a.length/2))),
  // v4: new patterns
  crescendo: a => a.map((x,i) => { const r=i/Math.max(1,a.length-1); return r<0.3?x.toLowerCase() : r<0.7?x : x.toUpperCase(); }),
  pulse:     a => a.map((x,i) => i%3===1 ? x.toUpperCase() : x.toLowerCase()),
  whisper:   a => a.map(x => x.toLowerCase().replace(/(.)/g, '$1·')),
};

const TIER_GATES = {
  babble_tier0:0, combo_phrases:2, babble_tier1:4, babble_tier2:6,
  babble_tier3:10, sound_invention:15, advanced_babble:20, crypto_language:40,
};

// ── v4: BREATH PATTERNS ────────────────────────────────────────
// Small sounds that mimic breathing between phrases
const BREATH_PATTERNS = {
  calm:    ['~', '...', '~~', ' '],
  excited: ['!', '-', '!!', ' '],
  tired:   ['...', '....', '.. ..', 'zzz'],
  curious: ['?', '..?', '~?', ' '],
  tense:   ['.', '..', '-', '...'],
};

// ── v4: MICRO-EXPRESSIONS ──────────────────────────────────────
// Tiny additions that make babble feel alive
const MICRO_EXPR = {
  sniff:     ['*сн*', '*фрр*', '*нюх*'],
  yawn:      ['*ааа~*', '*ммм~*', '*хаа~*'],
  sigh:      ['*хх..*', '*фф..*', '*пфх..*'],
  tail_wag:  ['~~', '~!', '~~~'],
  ear_twitch:['👂', '📡', ''],
  paw_tap:   ['🐾', '🐾🐾', ''],
  nose_boop: ['👃💨', ''],
  purr:      ['мрр~', 'ррр~', 'ммм~'],
  whimper:   ['скс..', 'хнн..', 'ыыы..'],
};

// ── v4: EMOTION BLEND MAP ──────────────────────────────────────
// When two emotions mix, which instrument settings to use
const EMOTION_BLENDS = {
  'happy+curious':    { tempo:'fast',  pitch:'high', pattern:'question',  connector:'! ' },
  'playful+alert':    { tempo:'fast',  pitch:'high', pattern:'staccato',  connector:'! ' },
  'content+curious':  { tempo:'mid',   pitch:'mid',  pattern:'question',  connector:'~ ' },
  'sad+lonely':       { tempo:'slow',  pitch:'low',  pattern:'echo',      connector:'... ' },
  'scared+curious':   { tempo:'mid',   pitch:'mid',  pattern:'stutter',   connector:'..? ' },
  'happy+excited':    { tempo:'burst', pitch:'high', pattern:'crescendo', connector:'! ' },
  'idle+hungry':      { tempo:'mid',   pitch:'mid',  pattern:'pulse',     connector:'~ ' },
  'playful+food_obsessed': { tempo:'fast', pitch:'mid', pattern:'bounce', connector:'-' },
  'alert+curious':    { tempo:'mid',   pitch:'high', pattern:'staccato',  connector:'? ' },
  'content+happy':    { tempo:'mid',   pitch:'mid',  pattern:'smooth',    connector:'~ ' },
  'lonely+scared':    { tempo:'halt',  pitch:'low',  pattern:'whisper',   connector:'... ' },
};


class BabbleEngine {
  constructor(seed = 0.5, unlockedSounds = []) {
    this.seed = seed;
    this._rng = this._mkRng(seed);
    this._unlockedSounds = unlockedSounds;
    this.ownerTopEmoji = [];
    this.soundMemory = [];
    this.inventedSounds = [];
    this._invCtr = 0;
    this.favC = this._pickN(CONSONANTS, 6, seed);
    this.favV = this._pickN(VOWELS, 4, seed + 0.1);
    this.signatureSound = this.favC[0]+this.favV[0]+this.favC[1]+this.favV[1]+this.favC[0];

    // v4: Affinity tracking — sounds that got positive feedback
    this.affinityMap = {};   // { soundFragment: score }
    this._lastGeneratedAtoms = [];

    // v4: Context state
    this._lastEmotionTs = Date.now();
    this._consecutiveEmotion = null;
    this._consecutiveCount = 0;
    this._conversationMomentum = 0; // 0=cold, 1=hot (rapid back-and-forth)
    this._lastGenerateTs = 0;
  }

  // ── RNG ────────────────────────────────────────────────────
  _mkRng(s) { let v=Math.floor(s*2147483647)||1; return ()=>{ v=(v*16807)%2147483647; return(v-1)/2147483646; }; }
  _rand() { return (this._rng()+Math.random())/2; }
  _pick(a) { return a[Math.floor(this._rand()*a.length)]; }
  _pickN(arr, n, seed) {
    const s=[...arr]; let v=Math.floor(seed*1000);
    for(let i=s.length-1;i>0;i--){ v=(v*16807)%2147483647; const j=v%(i+1); [s[i],s[j]]=[s[j],s[i]]; }
    return s.slice(0,n);
  }

  // ── Tier check ─────────────────────────────────────────────
  _has(level, tier) {
    if (level < (TIER_GATES[tier]??999)) return false;
    return !this._unlockedSounds.length || this._unlockedSounds.includes(tier);
  }

  // ── Atom generation ────────────────────────────────────────
  _atom(level, inst) {
    const r = this._rand();

    // v4: Affinity boost — prefer sounds that got positive feedback
    if (Object.keys(this.affinityMap).length > 0 && r < 0.12) {
      const top = Object.entries(this.affinityMap)
        .filter(([,v]) => v > 0.3)
        .sort((a,b) => b[1]-a[1]);
      if (top.length > 0) {
        const chosen = top[Math.floor(this._rand() * Math.min(3, top.length))];
        if (chosen) return chosen[0];
      }
    }

    if (this._has(level,'sound_invention') && this.inventedSounds.length && r<0.15) return this._pick(this.inventedSounds);
    if (level>=4 && this._rand()<0.08) return this.signatureSound;

    if (this._has(level,'crypto_language')) {
      if (r<0.15) return this._pick(ABSTRACT_SYMBOLS)+this._pick(ANIMAL_SOUNDS.tier2)+this._pick(ABSTRACT_SYMBOLS);
      if (r<0.30) return this._pick(ANIMAL_SOUNDS.tier3)+'~'+this._pick(ABSTRACT_SYMBOLS);
      if (r<0.45) return this._pick(ABSTRACT_SYMBOLS)+this._pick(ANIMAL_SOUNDS.tier1);
    }
    if (this._has(level,'advanced_babble')) {
      if (r<0.25) return this._pick(ANIMAL_SOUNDS.tier2)+'-'+this._pick(ANIMAL_SOUNDS.tier1);
      if (r<0.40) return this._pick(ANIMAL_SOUNDS.tier3);
      if (r<0.55) return this._pick(ANIMAL_SOUNDS.tier1)+' '+this._pick(ANIMAL_SOUNDS.tier1);
    }
    if (this._has(level,'babble_tier3')) {
      if (inst?.pitch==='high' && r<0.30) return this._pick(ANIMAL_SOUNDS.tier1).toUpperCase();
      if (r<0.25) return this._pick(ANIMAL_SOUNDS.tier1);
      if (r<0.45) return this._pick(ANIMAL_SOUNDS.tier2);
      if (r<0.60) return this._pick(ANIMAL_SOUNDS.tier0)+'-'+this._pick(ANIMAL_SOUNDS.tier0);
      return this._pick(ANIMAL_SOUNDS.tier1)+this._pick(ANIMAL_SOUNDS.tier0);
    }
    if (this._has(level,'babble_tier2')) {
      if (inst?.pitch==='high') {
        if (r<0.35) return this._pick(ANIMAL_SOUNDS.tier0);
        if (r<0.60) return this._pick(ANIMAL_SOUNDS.tier1);
        return this._pick(this.favC).toUpperCase()+this._pick(this.favV);
      }
      if (inst?.pitch==='low') {
        if (r<0.30) return this._pick(this.favV).repeat(2)+'~';
        if (r<0.55) return this._pick(ANIMAL_SOUNDS.tier0);
        return this._pick(ANIMAL_SOUNDS.tier1);
      }
      if (r<0.35) return this._pick(ANIMAL_SOUNDS.tier0);
      if (r<0.55) return this._pick(ANIMAL_SOUNDS.tier1);
      return this._pick(this.favC)+this._pick(this.favV)+this._pick(this.favV);
    }
    if (this._has(level,'babble_tier1')) {
      if (r<0.25) return this._pick(this.favC)+this._pick(this.favV);
      if (r<0.45) return this._pick(this.favV).repeat(Math.floor(this._rand()*2)+1);
      if (r<0.65) return this._pick(this.favC)+this._pick(this.favV)+this._pick(this.favC);
      if (r<0.80) return this._pick(ANIMAL_SOUNDS.tier0);
      return this._pick(this.favC)+this._pick(NOISE.slice(5));
    }
    if (this._has(level,'combo_phrases')) {
      if (r<0.40) return this._pick(this.favC)+this._pick(this.favV);
      if (r<0.65) return this._pick(this.favV)+this._pick(this.favC);
      return this._pick(this.favC).repeat(2)+this._pick(this.favV);
    }
    // tier0
    if (r<0.25) return this._pick(this.favC);
    if (r<0.45) return this._pick(this.favV);
    if (r<0.60) return this._pick(this.favV).repeat(2);
    if (r<0.80) return this._pick(NOISE);
    return this._pick(this.favC).repeat(Math.floor(this._rand()*2)+1);
  }

  // ── Assembly ───────────────────────────────────────────────
  _inst(em) { return EMOTION_INSTRUMENTS[em]||EMOTION_INSTRUMENTS.idle; }
  _rhythm(atoms, inst) { const fn=RHYTHM_PATTERNS[inst.pattern]; return fn ? fn([...atoms]) : atoms; }

  _assemble(atoms, inst, intensity) {
    const parts = this._rhythm(atoms, inst);
    let r = inst.tempo==='burst' ? parts.join('') : inst.tempo==='halt' ? parts.join('... ') : parts.join(inst.connector);
    const k = intensity<0.3?'low':intensity<0.6?'mid':intensity<0.85?'high':'extreme';
    return r + this._pick(INTENSITY_MARKS[k]);
  }

  _weaveEmoji(text, level) {
    if (!this.ownerTopEmoji?.length || this._rand()>Math.min(0.4+level*0.01,0.8)) return text;
    const e=this._pick(this.ownerTopEmoji), p=this._rand();
    if (p<0.3) return e+' '+text;
    if (p<0.7) return text+' '+e;
    const parts=text.split(' '); parts.splice(Math.floor(this._rand()*parts.length),0,e); return parts.join(' ');
  }

  _addTail(text, emotion, level) {
    if (level<2||this._rand()>0.35) return text;
    const i=this._inst(emotion);
    if (i.tempo==='fast'||i.tempo==='burst') return text+'\n'+this._pick(['🐾?','🐾!','🐾~','♡?']);
    if (i.pitch==='low') return text+'\n'+this._pick(['🐾...','♡..','🐾~']);
    return text+'\n'+this._pick(['🐾','♡','🐾?']);
  }

  // ── v4: Micro-expression injection ──────────────────────────
  _addMicroExpr(text, emotion, level, intensity) {
    if (level < 3 || this._rand() > 0.35) return text;

    let type;
    if (['nap','sleep','content'].includes(emotion)) type = 'purr';
    else if (['scared','sad','lonely'].includes(emotion)) type = 'whimper';
    else if (['curious','puzzle_solving','alert'].includes(emotion)) type = 'sniff';
    else if (['idle'].includes(emotion) && intensity < 0.3) type = 'yawn';
    else if (['idle','content'].includes(emotion) && this._rand() < 0.3) type = 'sigh';
    else if (['happy','playful','greeting_frenzy','zoomies'].includes(emotion)) type = 'tail_wag';
    else if (['food_obsessed','hungry'].includes(emotion)) type = 'sniff';
    else type = this._pick(['paw_tap','ear_twitch','nose_boop']);

    const micro = this._pick(MICRO_EXPR[type] || ['']);
    if (!micro) return text;

    // Place micro-expression: before, between, or after
    const pos = this._rand();
    if (pos < 0.3) return micro + ' ' + text;
    if (pos < 0.6) {
      const parts = text.split(' ');
      if (parts.length > 2) {
        const idx = 1 + Math.floor(this._rand() * (parts.length - 1));
        parts.splice(idx, 0, micro);
        return parts.join(' ');
      }
    }
    return text + ' ' + micro;
  }

  // ── v4: Breath pattern between phrases ──────────────────────
  _addBreath(text, emotion, intensity) {
    if (this._rand() > 0.25) return text;

    let breathType;
    if (['happy','playful','excited','zoomies','greeting_frenzy'].includes(emotion)) breathType = 'excited';
    else if (['nap','sleep','idle','content'].includes(emotion)) breathType = 'calm';
    else if (['curious','puzzle_solving','alert'].includes(emotion)) breathType = 'curious';
    else if (['scared','anxious','sad','lonely'].includes(emotion)) breathType = 'tense';
    else breathType = 'calm';

    const breath = this._pick(BREATH_PATTERNS[breathType]);
    const parts = text.split(' ');
    if (parts.length < 3) return text;

    // Insert breath after ~40% of the phrase
    const idx = Math.floor(parts.length * 0.4);
    parts.splice(idx, 0, breath);
    return parts.join(' ');
  }

  // ── v4: Emotion blend ──────────────────────────────────────
  _blendedInstrument(emotion1, emotion2) {
    const key1 = `${emotion1}+${emotion2}`;
    const key2 = `${emotion2}+${emotion1}`;
    return EMOTION_BLENDS[key1] || EMOTION_BLENDS[key2] || null;
  }

  // ── Sound invention (15+) ─────────────────────────────────
  inventSound() {
    this._invCtr++;
    if (this._invCtr<12||this._rand()>0.2) return null;
    this._invCtr=0;
    const c=this.favC, v=this.favV, t=this._rand();
    let s;
    if      (t<0.25) s=c[0]+v[0]+c[1]+'-'+c[2]+v[1]+c[0];
    else if (t<0.50) s=v[0].repeat(2)+c[0]+v[1]+c[1];
    else if (t<0.75) s=c[0].repeat(3)+v[0].repeat(2);
    else              s=this.signatureSound+'~'+v[this._rand()<0.5?0:1];
    if (!this.inventedSounds.includes(s)) {
      this.inventedSounds.push(s);
      if (this.inventedSounds.length>12) this.inventedSounds.shift();
      return s;
    }
    return null;
  }

  // ── generate ───────────────────────────────────────────────
  generate(level=0, emotion='idle', intensity=0.5) {
    const inst=this._inst(emotion);
    const invented=this._has(level,'sound_invention') ? this.inventSound() : null;

    // v4: Track consecutive same-emotion to add variety
    if (emotion === this._consecutiveEmotion) {
      this._consecutiveCount++;
    } else {
      this._consecutiveEmotion = emotion;
      this._consecutiveCount = 0;
    }

    // v4: Conversation momentum (time between generates)
    const now = Date.now();
    const gap = now - this._lastGenerateTs;
    if (gap < 10000) this._conversationMomentum = Math.min(1, this._conversationMomentum + 0.15);
    else if (gap < 60000) this._conversationMomentum = Math.max(0, this._conversationMomentum - 0.1);
    else this._conversationMomentum = 0;
    this._lastGenerateTs = now;

    let base = level<2?2 : level<6?3 : level<15?4 : level<30?5 : 6;
    if (inst.tempo==='burst') base=Math.max(base,4);
    if (inst.tempo==='halt') base=Math.max(1,base-2);

    // v4: High momentum = slightly longer phrases
    if (this._conversationMomentum > 0.5) base = Math.min(base + 1, 7);

    const count=Math.max(1,Math.round(base*(0.7+intensity*0.6)));

    const atoms=[];
    if (level>=4 && this._rand()<0.2) atoms.push(this.signatureSound);
    for (let i=atoms.length; i<count; i++) {
      if (invented && i===Math.floor(count/2)) atoms.push(invented);
      else atoms.push(this._atom(level,inst));
    }

    // v4: Track atoms for affinity
    this._lastGeneratedAtoms = [...atoms];

    let result=this._assemble(atoms,inst,intensity);
    result=this._weaveEmoji(result,level);

    // v4: Add breath pattern
    result=this._addBreath(result, emotion, intensity);

    // v4: Add micro-expression
    result=this._addMicroExpr(result, emotion, level, intensity);

    result=this._addTail(result,emotion,level);

    // v4: If same emotion 3+ times in a row, force variety
    if (this._consecutiveCount >= 3 && this.soundMemory.length > 0) {
      // Shift some atoms to break repetition
      atoms[0] = this._atom(level, inst);
      if (atoms.length > 2) atoms[atoms.length-1] = this._atom(level, inst);
      result = this._assemble(atoms, inst, intensity);
      result = this._weaveEmoji(result, level);
      result = this._addBreath(result, emotion, intensity);
      result = this._addMicroExpr(result, emotion, level, intensity);
      result = this._addTail(result, emotion, level);
    }

    if (this.soundMemory.includes(result)) {
      atoms[Math.floor(this._rand()*atoms.length)]=this._atom(level,inst);
      result=this._assemble(atoms,inst,intensity);
      result=this._weaveEmoji(result,level);
      result=this._addBreath(result, emotion, intensity);
      result=this._addMicroExpr(result, emotion, level, intensity);
      result=this._addTail(result,emotion,level);
    }
    this.soundMemory.push(result);
    if (this.soundMemory.length>20) this.soundMemory.shift();
    return result;
  }

  // ── generateReply ──────────────────────────────────────────
  generateReply(level, emotion, intensity, category) {
    switch(category) {
      case 'greeting': return this.generate(level,'greeting_frenzy',Math.min(intensity+0.3,1))+' '+this._pick(['♡','♡♡','💛','']);
      case 'praise':   return this.generate(level,'happy',Math.min(intensity+0.2,1))+' '+this._pick(['♡♡','💛💛💛','✨♡']);
      case 'scold':    return this.generate(level,'scared',Math.max(intensity-0.3,0.1))+' '+this._pick(['💧','...','']);
      case 'feed':     return this.generate(level,'food_obsessed',Math.min(intensity+0.3,1));
      default:         return this.generate(level,emotion,intensity);
    }
  }

  // ── v4: generateBlended — two emotions at once ──────────────
  generateBlended(level, emotion1, emotion2, intensity) {
    const blended = this._blendedInstrument(emotion1, emotion2);
    if (!blended) {
      // No blend defined — generate both and merge
      const a = this.generate(level, emotion1, intensity);
      const b = this.generate(level, emotion2, intensity * 0.6);
      return a + ' ' + this._pick(['~','...','—','']) + ' ' + b;
    }

    // Use blended instrument
    const invented = this._has(level,'sound_invention') ? this.inventSound() : null;
    let base = level<2?2 : level<6?3 : level<15?4 : level<30?5 : 6;
    if (blended.tempo==='burst') base=Math.max(base,4);
    const count = Math.max(2, Math.round(base*(0.7+intensity*0.6)));

    const atoms = [];
    // Mix atoms from both emotion instruments
    const inst1 = this._inst(emotion1);
    const inst2 = this._inst(emotion2);
    for (let i = 0; i < count; i++) {
      if (invented && i === Math.floor(count/2)) atoms.push(invented);
      else atoms.push(this._atom(level, this._rand() < 0.6 ? inst1 : inst2));
    }

    let result = this._assemble(atoms, blended, intensity);
    result = this._weaveEmoji(result, level);
    result = this._addBreath(result, emotion1, intensity);
    result = this._addMicroExpr(result, emotion1, level, intensity);
    result = this._addTail(result, emotion1, level);
    return result;
  }

  // ── v4: generateIdle — rich idle babble (not repetitive) ────
  generateIdle(level, vitals = {}) {
    const { energy = 0.5, hunger = 0.2, loneliness = 0.1, curiosity = 0.5 } = vitals;

    // Pick sub-emotion based on vitals
    let emotion = 'idle';
    let intensity = 0.3;

    if (energy < 0.3) {
      emotion = this._rand() < 0.5 ? 'nap' : 'content';
      intensity = 0.2;
    } else if (hunger > 0.6) {
      emotion = this._rand() < 0.4 ? 'hungry' : 'idle';
      intensity = 0.4 + hunger * 0.3;
    } else if (loneliness > 0.5) {
      emotion = this._pick(['lonely', 'sad', 'puppy_eyes']);
      // Map puppy_eyes → sad for instrument (no puppy_eyes instrument)
      if (emotion === 'puppy_eyes') emotion = 'sad';
      intensity = 0.3 + loneliness * 0.3;
    } else if (curiosity > 0.6) {
      emotion = this._rand() < 0.5 ? 'curious' : 'alert';
      intensity = 0.3 + curiosity * 0.2;
    } else if (energy > 0.8 && this._rand() < 0.3) {
      emotion = 'playful';
      intensity = 0.4;
    }

    const babble = this.generate(level, emotion, intensity);

    // Add idle-specific micro flavor
    const r = this._rand();
    if (r < 0.15 && level >= 3) return this._pick(MICRO_EXPR.yawn) + ' ' + babble;
    if (r < 0.25 && level >= 3) return babble + ' ' + this._pick(MICRO_EXPR.sigh);
    if (r < 0.35 && level >= 5) return this._pick(MICRO_EXPR.sniff) + ' ' + babble + ' ' + this._pick(MICRO_EXPR.sniff);
    return babble;
  }

  // ── v4: generateAfterSilence — when owner returns ───────────
  generateAfterSilence(level, silenceMinutes, emotion = 'greeting_frenzy') {
    if (silenceMinutes < 5) return this.generate(level, emotion, 0.5);

    let intensity;
    let em;
    if (silenceMinutes > 120) {
      // Very long absence — explosion of joy
      em = 'greeting_frenzy';
      intensity = 0.95;
    } else if (silenceMinutes > 60) {
      em = 'greeting_frenzy';
      intensity = 0.8;
    } else if (silenceMinutes > 30) {
      em = 'happy';
      intensity = 0.7;
    } else {
      em = 'happy';
      intensity = 0.5;
    }

    const base = this.generate(level, em, intensity);

    // Add signature sound for recognition after long absence
    if (silenceMinutes > 60 && level >= 4) {
      return this.signatureSound + '!! ' + base + ' ' + this.signatureSound + '♡';
    }
    return base;
  }

  // ── generateSemanticReply (with phonetic echo) ─────────────
  generateSemanticReply(level, emotion, intensity, ownerText) {
    const base=this.generate(level,emotion,intensity);
    if (!ownerText||level<2) return base;
    const chance = level<6?0.2 : level<15?0.4 : 0.6;
    if (this._rand()>chance) return base;
    const echo=this.extractPhoneticEcho(ownerText);
    if (!echo) return base;
    const r=this._rand();
    if (r<0.4) return echo+' '+base;
    if (r<0.7) return base+' '+echo;
    const parts=base.split(' ');
    if (parts.length>1) { parts[Math.floor(this._rand()*parts.length)]=echo; return parts.join(' '); }
    return base+' '+echo;
  }

  // ── extractPhoneticEcho ────────────────────────────────────
  extractPhoneticEcho(ownerText) {
    if (!ownerText||ownerText.length<2) return null;
    const words=ownerText.toLowerCase().replace(/[^а-яёa-z\s]/g,'').split(/\s+/).filter(w=>w.length>=2);
    if (!words.length) return null;
    const word=this._pick(words);
    const frag=word.slice(0,Math.min(3,Math.ceil(word.length*0.4)));
    if (!/[а-яё]/i.test(frag)) return null;
    const hasV=/[аеёиоуыэюя]/i.test(frag);
    let echo = hasV
      ? frag+'-'+(frag.match(/[аеёиоуыэюя]/gi)?.pop()||'у').repeat(2)
      : frag+this._pick(this.favV);
    const r=this._rand();
    echo += r<0.3?'~' : r<0.6?'!' : '..';
    return echo;
  }

  // ── getVocabularyPrompt ────────────────────────────────────
  getVocabularyPrompt(level) {
    const smp=Array.from({length:4},()=>this.generate(level,'idle',0.3+Math.random()*0.4));
    const sig=level>=4?`\nФирменный звук: "${this.signatureSound}"`:'';
    const inv=this.inventedSounds.length?`\nИзобретённые: ${this.inventedSounds.join(', ')}`:'';
    const emo=this.ownerTopEmoji.length?`\nEmoji хозяина: ${this.ownerTopEmoji.join(' ')}`:'';
    const ex=`\nПримеры: ${smp.join(', ')}`;

    if (level<2) return `\n## Словарь (УР.${level} — новорождённый)\nТолько буквы, шум. ЗАПРЕЩЕНО: "гав","тяф" — не умеет.\nБуквы: ${this.favC.join(',')} + ${this.favV.join(',')}${ex}`;
    if (level<4) return `\n## Словарь (УР.${level} — первые слова)\nКомбинации 2 букв, неуклюже.\nБуквы: ${this.favC.join(',')} + ${this.favV.join(',')}${ex}`;
    if (level<6) return `\n## Словарь (УР.${level} — слоги)\nНастоящие слоги: ${ANIMAL_SOUNDS.tier0.join(', ')}${sig}${ex}`;
    if (level<10) return `\n## Словарь (УР.${level} — щенок)\nЗвуки: ${[...ANIMAL_SOUNDS.tier0,...ANIMAL_SOUNDS.tier1.slice(0,4)].join(', ')}${sig}${emo}\nРитм: Радость=быстро,КАПС | Грусть=тихо,паузы${ex}`;
    if (level<15) return `\n## Словарь (УР.${level} — подросток)\nЗвуки: ${[...ANIMAL_SOUNDS.tier1,...ANIMAL_SOUNDS.tier2].join(', ')}${sig}${inv}${emo}\nЭмоция=инструмент: staccato/bounce/fade/echo${ex}`;
    if (level<20) return `\n## Словарь (УР.${level} — изобретатель)\nЗвуки: ${[...ANIMAL_SOUNDS.tier2,...ANIMAL_SOUNDS.tier3].join(', ')}${sig}${inv}${emo}\nСоздаёт НОВЫЕ звуки. Ответ=музыкальная фраза.${ex}`;
    if (level<40) return `\n## Словарь (УР.${level} — взрослый)\nЗвуки: ${[...ANIMAL_SOUNDS.tier2,...ANIMAL_SOUNDS.tier3].join(', ')}\nСимволы: ${ABSTRACT_SYMBOLS.slice(0,5).join(' ')}${sig}${inv}${emo}\nМастер ритма. Fast+High=барабан, Slow+Low=виолончель${ex}`;
    return `\n## Словарь (УР.${level} — крипто-язык)\nСимволы: ${ABSTRACT_SYMBOLS.join(' ')}\nЗвуки: ${ANIMAL_SOUNDS.tier3.join(', ')}${sig}${inv}${emo}\nКрипто-паттерны: ◈рру◈ ∿ууу∿ ⟡ГАВ!⟡${ex}`;
  }

  // ── Unlocked sounds ────────────────────────────────────────
  setUnlockedSounds(arr) { this._unlockedSounds = arr||[]; }

  // ── updateOwnerEmoji (used by telegram.js) ─────────────────
  updateOwnerEmoji(topEmoji) { this.ownerTopEmoji = topEmoji||[]; }

  // ── v4: Affinity imprint — actually learns from feedback ───
  imprint(lastReply, boost=0.3) {
    if (!lastReply || !this._lastGeneratedAtoms.length) return;
    // Boost affinity for atoms used in the praised reply
    for (const atom of this._lastGeneratedAtoms) {
      if (atom.length < 2) continue; // skip single chars
      const key = atom.toLowerCase().replace(/[^а-яёa-z]/g, '').slice(0, 6);
      if (!key) continue;
      this.affinityMap[key] = Math.min(1.0, (this.affinityMap[key] || 0) + boost);
    }
    // Decay all affinities slightly to prevent lock-in
    for (const k of Object.keys(this.affinityMap)) {
      this.affinityMap[k] *= 0.95;
      if (this.affinityMap[k] < 0.05) delete this.affinityMap[k];
    }
  }

  // ── generateEnhanced (delegates to generate) ──────────────
  generateEnhanced(level, emotion, intensity, ownerText=null) {
    return ownerText ? this.generateSemanticReply(level,emotion,intensity,ownerText)
                     : this.generate(level,emotion,intensity);
  }

  // ── Serialization ──────────────────────────────────────────
  serialize() {
    return {
      seed:this.seed, soundMemory:this.soundMemory, inventedSounds:this.inventedSounds,
      ownerTopEmoji:this.ownerTopEmoji, favC:this.favC, favV:this.favV,
      signatureSound:this.signatureSound, unlockedSounds:this._unlockedSounds, invCtr:this._invCtr,
      affinityMap:this.affinityMap, conversationMomentum:this._conversationMomentum,
    };
  }
  // Aliases for backward compat (telegram.js uses .save()/.load())
  save() { return this.serialize(); }
  load(data) {
    if (!data) return;
    this.soundMemory=data.soundMemory||[]; this.inventedSounds=data.inventedSounds||[];
    this.ownerTopEmoji=data.ownerTopEmoji||[]; this._invCtr=data.invCtr||data.inventionCounter||0;
    if (data.favC||data.favoriteConsonants) this.favC=data.favC||data.favoriteConsonants;
    if (data.favV||data.favoriteVowels) this.favV=data.favV||data.favoriteVowels;
    if (data.signatureSound) this.signatureSound=data.signatureSound;
    if (data.seed) { this.seed=data.seed; this._rng=this._mkRng(data.seed); }
    if (data.affinityMap) this.affinityMap=data.affinityMap;
    if (data.conversationMomentum) this._conversationMomentum=data.conversationMomentum;
  }

  static deserialize(data, seed) {
    const e=new BabbleEngine(data?.seed??seed, data?.unlockedSounds??[]);
    if (!data) return e;
    e.load(data);
    return e;
  }
}

export { BabbleEngine, TIER_GATES, ANIMAL_SOUNDS, ABSTRACT_SYMBOLS, EMOTION_INSTRUMENTS, MICRO_EXPR, BREATH_PATTERNS };
