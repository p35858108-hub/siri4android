// =====================================================================
//  Siri liquid-glass island  ·  derivado de neeldedkawala/ios-siri-animation (MIT)
//  Se conserva: shader de refracción (Snell), ondas volumétricas, SpringPhysics.
//  Se elimina: fondos/wallpapers, panel de temas, mockup de iPhone, sombra SVG, ruido.
// =====================================================================

const PARAMS = {
  // Resortes (tamaño de la isla)
  kW: 380, cW: 26, kH: 300, cH: 24, mass: 1.0,

  // Geometría (px CSS)
  topOffset: 8,                                   // separación al borde superior (cubre el recorte de cámara)
  bubble: { wFrac: 0.52, wMax: 210, h: 46 },      // Estado 1
  input:  { wFrac: 0.48, wMax: 190, h: 128 },     // Estado 2 y 3 (más estrecha y más larga)
  answer: { wFrac: 0.92, hFrac: 0.42 },           // Estado 4 (~42 % del alto)
  waveRowY: 23,                                   // centro de la franja de ondas desde el borde superior
  waveYUnit: 80,                                  // unidad vertical fija de las ondas (px)

  // Óptica de cristal (valores del repo)
  scaleRatio: 3.80, bezelWidth: 58.0, glassThickness: 31.0, ior: 3.05,
  dispersionScale: 2.0, surfaceCurvature: 8.0,
  glassTint: [0.94, 0.96, 1.0], absorption: 0.0, bodyAlpha: 0.94,
  bottomRimIntensity: 0.97, bottomRimWidth: 1.4,

  // Refracción de ondas en el borde
  waveRefract: 6.30, waveDispersion: 15.0, waveEdgeBand: 4.5, wavePower: 1.55,

  // Ondas
  colors: ['#002fff', '#00ffde', '#fa1f1f', '#ff930d', '#9900ff', '#00ff88'],  // tema "Intelligence"
  lineThickness: 0.056, spindleWidth: 2.30, pinTaper: 2.8, activeWaves: 4,
  yScale: 0.110, xScale: 1.6, fillOpacity: 1.0,
  glowFalloff: 1.5, glowIntensity: 1.15, edgeFade: 0.42,
  hotCoreThreshold: 7.2, hotCoreIntensity: 3.2,
  phaseDistance: -4.1, speed: -2.7,
  waveFadeDuration: 0.50, waveIntroDuration: 0.65, introStartAmp: 0.20,
  energyBoost: 2.2                                // multiplicador de velocidad/intensidad en "cargando"
};

// ---------------------------------------------------------------------
//  Resorte armónico de segundo orden (del repo)
// ---------------------------------------------------------------------
class SpringPhysics {
  constructor(k, c, m, v0 = 0) { this.value = v0; this.target = v0; this.velocity = 0; this.k = k; this.c = c; this.m = m; }
  setTarget(t, impulse = 0) { this.target = t; if (impulse) this.velocity += impulse; }
  snap(v) { this.value = this.target = v; this.velocity = 0; }
  update(delta) {
    const dt = Math.min(delta, 0.033), n = 4, sub = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.value - this.target) - this.c * this.velocity) / Math.max(this.m, 0.01);
      this.velocity += a * sub;
      this.value += this.velocity * sub;
    }
    if (Math.abs(this.velocity) < 1e-4 && Math.abs(this.value - this.target) < 1e-4) { this.value = this.target; this.velocity = 0; }
    return this.value;
  }
}
const smoothEase = t => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const hexToVec3 = h => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

// ---------------------------------------------------------------------
//  Tamaños por estado
// ---------------------------------------------------------------------
let W = window.innerWidth, H = window.innerHeight;
const TOP = PARAMS.topOffset;
const SIZES = {
  bubble:  () => ({ w: Math.min(PARAMS.bubble.wMax, W * PARAMS.bubble.wFrac), h: PARAMS.bubble.h }),
  input:   () => ({ w: Math.min(PARAMS.input.wMax,  W * PARAMS.input.wFrac),  h: PARAMS.input.h }),
  loading: () => SIZES.input(),
  answer:  () => ({ w: Math.min(W - 24, W * PARAMS.answer.wFrac), h: Math.round(H * PARAMS.answer.hFrac) })
};

const sw = new SpringPhysics(PARAMS.kW, PARAMS.cW, PARAMS.mass);
const sh = new SpringPhysics(PARAMS.kH, PARAMS.cH, PARAMS.mass);
const energy = new SpringPhysics(120, 16, 1);
{ const s = SIZES.bubble(); sw.snap(s.w); sh.snap(s.h); }

// ---------------------------------------------------------------------
//  Three.js + shader
// ---------------------------------------------------------------------
const glHost = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
glHost.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Textura procedural (sustituye a los wallpapers): tinte sutil que se refracta en el borde
function makeBgTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0c14'; g.fillRect(0, 0, 256, 256);
  [[40, 210, 150, 'rgba(30,70,255,.75)'], [215, 40, 140, 'rgba(0,255,222,.50)'],
   [215, 220, 110, 'rgba(255,147,13,.45)'], [50, 45, 100, 'rgba(153,0,255,.50)']].forEach(([x, y, r, col]) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const vertexShader = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

const fragmentShader = `
  precision highp float;

  uniform float u_time, u_waveFade, u_waveIntro, u_introStartAmp, u_energy;
  uniform vec2  u_resolution, u_half, u_center;
  uniform float u_radius, u_waveRowY, u_waveYUnit, u_bodyAlpha;
  uniform sampler2D u_bg;

  uniform float u_scaleRatio, u_bezelWidth, u_glassThickness, u_ior, u_dispersionScale, u_surfaceCurvature;
  uniform vec3  u_glassTint;
  uniform float u_absorption;

  uniform float u_waveRefract, u_waveDispersion, u_waveEdgeBand, u_wavePower;
  uniform float u_bottomRimIntensity, u_bottomRimWidth;

  uniform float xScale, yScale, phaseDistance, lineThickness, pinTaper, spindleWidth;
  uniform float glowFalloff, glowIntensity, edgeFade, hotCoreThreshold, hotCoreIntensity, fillOpacity;
  uniform int   activeWaves;
  uniform vec3  uColors[6];

  varying vec2 vUv;
  #define PI 3.14159265359

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))) - r;
  }
  float islandSDF(vec2 p) { return sdRoundBox(p, u_half, u_radius); }

  vec2 calcNormal2D(vec2 p) {
    float h = 0.5;
    vec2 k = vec2(1.0, -1.0);
    return normalize(
      k.xy * islandSDF(p + k.xy * h) + k.yy * islandSDF(p + k.yy * h) +
      k.yx * islandSDF(p + k.yx * h) + k.xx * islandSDF(p + k.xx * h));
  }

  float snellDisplacement(float d, float bWidth, float thickness, float nMedium, float curveExp, out float outH) {
    if (d >= bWidth || d <= 0.0) { outH = (d <= 0.0) ? 0.0 : thickness; return 0.0; }
    float u = clamp(d / max(bWidth, 1.0), 0.0, 1.0);
    float innerArc = clamp(1.0 - pow(1.0 - u, curveExp), 0.0, 1.0);
    outH = thickness * sqrt(innerArc);
    float denom = max(sqrt(innerArc), 0.05);
    float dh_dd = (thickness / max(bWidth, 1.0)) * (pow(1.0 - u, max(curveExp - 1.0, 0.0)) / denom);
    float theta1 = atan(dh_dd);
    float sinTheta2 = clamp(sin(theta1) / max(nMedium, 1.001), -0.999, 0.999);
    float theta2 = asin(sinTheta2);
    return outH * tan(theta1 - theta2);
  }

  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y) * u_resolution;     // px CSS, y hacia abajo
    vec2 p = uv - u_center;

    float dIsland = islandSDF(p);
    float afwidth = length(vec2(dFdx(dIsland), dFdy(dIsland))) * 0.7071;
    if (dIsland > 2.0) { gl_FragColor = vec4(0.0); return; }  // fuera de la isla: casi gratis
    float edgeIsland = 1.0 - smoothstep(-afwidth, afwidth, dIsland);

    vec2 norm2D = calcNormal2D(p);
    float distFromBorder = max(0.0, -dIsland);

    // --- Cristal: refracción de Snell con dispersión cromática ---
    float minHalf = min(u_half.x, u_half.y);
    float s = clamp(minHalf / 41.0, 0.35, 1.0);
    float bezel = u_bezelWidth * s;
    float thick = u_glassThickness * s;

    float glassH = 0.0;
    float dispFactor = u_dispersionScale * 0.15;
    float dR = snellDisplacement(distFromBorder, bezel, thick, u_ior - dispFactor * 0.04, u_surfaceCurvature, glassH);
    float dG = snellDisplacement(distFromBorder, bezel, thick, u_ior,                      u_surfaceCurvature, glassH);
    float dB = snellDisplacement(distFromBorder, bezel, thick, u_ior + dispFactor * 0.07, u_surfaceCurvature, glassH);

    float scaleMul = u_scaleRatio * s;
    vec2 base = vec2(p.x / (2.0 * u_half.x) + 0.5, 0.5 - p.y / (2.0 * u_half.y));
    vec2 inv = vec2(1.0 / (2.0 * u_half.x), 1.0 / (2.0 * u_half.y));
    vec2 uvR = base + vec2(-norm2D.x * dR, norm2D.y * dR) * scaleMul * inv;
    vec2 uvG = base + vec2(-norm2D.x * dG, norm2D.y * dG) * scaleMul * inv;
    vec2 uvB = base + vec2(-norm2D.x * dB, norm2D.y * dB) * scaleMul * inv;
    vec3 refractedBg = vec3(texture2D(u_bg, clamp(uvR, 0.0, 1.0)).r,
                            texture2D(u_bg, clamp(uvG, 0.0, 1.0)).g,
                            texture2D(u_bg, clamp(uvB, 0.0, 1.0)).b);

    float opticalDepth = (glassH / max(thick, 1.0)) * u_absorption;
    refractedBg *= exp(-opticalDepth * (vec3(1.0) - u_glassTint));

    float yRatio = clamp((p.y + u_half.y) / (2.0 * u_half.y), 0.0, 1.0);          // 0 arriba, 1 abajo
    float grow = smoothstep(50.0, 130.0, 2.0 * u_half.y);                          // la burbuja es negra; al crecer se vuelve vidrio
    float translucency = smoothstep(0.15, 1.0, yRatio) * 0.40 * grow;
    float lens = 1.0 - smoothstep(0.0, bezel, distFromBorder);
    vec3 baseDark = vec3(0.035, 0.040, 0.055);
    vec3 glassBody = mix(baseDark, refractedBg * 1.4, clamp(translucency + lens * 0.30, 0.0, 1.0));

    // --- Ondas volumétricas (franja superior, ancho = ancho de la isla) ---
    vec3 accumulatedWave = vec3(0.0);
    if (u_waveFade > 0.001) {
      vec2 pw = p - vec2(0.0, u_waveRowY - u_half.y);

      float ampWeights[6];   ampWeights[0]=1.30; ampWeights[1]=0.70; ampWeights[2]=1.22; ampWeights[3]=0.72; ampWeights[4]=0.60; ampWeights[5]=0.60;
      float thickWeights[6]; thickWeights[0]=1.35; thickWeights[1]=0.72; thickWeights[2]=1.30; thickWeights[3]=0.75; thickWeights[4]=0.60; thickWeights[5]=0.60;
      float phWeights[6];    phWeights[0]=0.00; phWeights[1]=0.38; phWeights[2]=0.75; phWeights[3]=1.15; phWeights[4]=1.50; phWeights[5]=1.85;

      vec3 waveAccum = vec3(0.0);
      float totalDensity = 0.0;
      float waveIntersectCount = 0.0;

      float edgeZone = clamp(1.0 - (distFromBorder / max(u_waveEdgeBand, 1.0)), 0.0, 1.0);
      float edgeMask = pow(edgeZone, u_wavePower);
      float boost = 1.0 + 0.9 * u_energy;

      for (int i = 0; i < 6; i++) {
        if (i >= activeWaves) break;
        float numW = max(float(activeWaves - 1), 1.0);
        float staggerStart = (float(i) / numW) * 0.42;
        float raw = clamp((u_waveIntro - staggerStart) / 0.58, 0.0, 1.0);
        float waveProgress = raw * raw * (3.0 - 2.0 * raw);

        float dispersionOffset = (float(i) - 1.5) * (u_waveDispersion * 0.25);
        float waveDispMag = (edgeZone * u_waveRefract * 4.0) + (dispersionOffset * edgeMask);
        vec2 pWave = pw - norm2D * (waveDispMag * edgeMask);

        vec2 wp = vec2(pWave.x / u_half.x, pWave.y / u_waveYUnit);
        float nx = (wp.x / spindleWidth) + 0.5;

        if (nx > 0.0 && nx < 1.0) {
          float envelope = pow(sin(nx * PI), pinTaper);
          float eFade = max(edgeFade, 0.001);
          float fadeMask = smoothstep(0.0, eFade, nx) * (1.0 - smoothstep(1.0 - eFade, 1.0, nx));

          float baseAngle = wp.x * xScale;
          float dynamicHarmonic = 1.0 + 0.12 * sin(u_time * 1.5 + float(i) * 1.3);
          float targetAmp = ampWeights[i] * dynamicHarmonic * boost;

          float amp = mix(u_introStartAmp, targetAmp, waveProgress) * yScale * envelope;
          float ph = phaseDistance * phWeights[i] * waveProgress;
          float waveY = sin(baseAngle + u_time + ph) * amp;
          float dist = abs(wp.y + waveY);

          float thickMult = mix(1.0, thickWeights[i], waveProgress) * (1.0 + 0.25 * u_energy);
          float curThick = lineThickness * envelope * thickMult;

          float w = pow(clamp(curThick / (dist + curThick * 0.32), 0.0, 1.0), glowFalloff) * fillOpacity;
          waveAccum += w * uColors[i] * fadeMask;
          totalDensity += w * fadeMask;
          waveIntersectCount += 1.0 - smoothstep(0.0, curThick * 2.2, dist);
        }
      }

      if (totalDensity > hotCoreThreshold && waveIntersectCount >= 2.6) {
        float whiteFactor = smoothstep(hotCoreThreshold, hotCoreThreshold + 3.0, totalDensity);
        waveAccum = mix(waveAccum, vec3(1.0) * hotCoreIntensity, whiteFactor * 0.85);
      }

      float vFade = 1.0 - smoothstep(30.0, 90.0, abs(pw.y));     // el brillo no ensucia el texto de abajo
      accumulatedWave = waveAccum * glowIntensity * (1.0 + 0.35 * u_energy) * u_waveFade * vFade;
    }

    // --- Menisco blanco inferior ---
    float bottomFactor = clamp((p.y + u_half.y * 0.25) / (u_half.y * 1.25), 0.0, 1.0);
    float rimGlow = (1.0 - smoothstep(0.0, max(u_bottomRimWidth, 0.1), distFromBorder)) * bottomFactor * grow;
    vec3 rim = vec3(0.96, 0.98, 1.0) * (rimGlow * u_bottomRimIntensity);

    vec3 rgb = glassBody + accumulatedWave + rim;
    float alpha = edgeIsland * clamp(u_bodyAlpha + dot(accumulatedWave, vec3(0.33)), 0.0, 1.0);
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), alpha);
  }
`;

const U = {
  u_time: { value: 0 }, u_waveFade: { value: 0 }, u_waveIntro: { value: 0 },
  u_introStartAmp: { value: PARAMS.introStartAmp }, u_energy: { value: 0 },
  u_resolution: { value: new THREE.Vector2(W, H) },
  u_half: { value: new THREE.Vector2() }, u_center: { value: new THREE.Vector2() },
  u_radius: { value: 23 }, u_waveRowY: { value: PARAMS.waveRowY }, u_waveYUnit: { value: PARAMS.waveYUnit },
  u_bodyAlpha: { value: PARAMS.bodyAlpha }, u_bg: { value: makeBgTexture() },
  u_scaleRatio: { value: PARAMS.scaleRatio }, u_bezelWidth: { value: PARAMS.bezelWidth },
  u_glassThickness: { value: PARAMS.glassThickness }, u_ior: { value: PARAMS.ior },
  u_dispersionScale: { value: PARAMS.dispersionScale }, u_surfaceCurvature: { value: PARAMS.surfaceCurvature },
  u_glassTint: { value: new THREE.Vector3(...PARAMS.glassTint) }, u_absorption: { value: PARAMS.absorption },
  u_waveRefract: { value: PARAMS.waveRefract }, u_waveDispersion: { value: PARAMS.waveDispersion },
  u_waveEdgeBand: { value: PARAMS.waveEdgeBand }, u_wavePower: { value: PARAMS.wavePower },
  u_bottomRimIntensity: { value: PARAMS.bottomRimIntensity }, u_bottomRimWidth: { value: PARAMS.bottomRimWidth },
  xScale: { value: PARAMS.xScale }, yScale: { value: PARAMS.yScale }, phaseDistance: { value: PARAMS.phaseDistance },
  lineThickness: { value: PARAMS.lineThickness }, pinTaper: { value: PARAMS.pinTaper }, spindleWidth: { value: PARAMS.spindleWidth },
  glowFalloff: { value: PARAMS.glowFalloff }, glowIntensity: { value: PARAMS.glowIntensity }, edgeFade: { value: PARAMS.edgeFade },
  hotCoreThreshold: { value: PARAMS.hotCoreThreshold }, hotCoreIntensity: { value: PARAMS.hotCoreIntensity },
  fillOpacity: { value: PARAMS.fillOpacity }, activeWaves: { value: PARAMS.activeWaves },
  uColors: { value: PARAMS.colors.map(hexToVec3) }
};
scene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: U, transparent: true, extensions: { derivatives: true } })
));

// ---------------------------------------------------------------------
//  UI: estados, mensajes y puente con Android
// ---------------------------------------------------------------------
const island = document.getElementById('island');
const answerEl = document.getElementById('answer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

let state = 'bubble';   // bubble -> input -> loading -> answer
let busy = false;
let botMsg = null;
let lastQuery = '';
let voiceActive = false;

function setState(s, focus = true) {
  state = s;
  island.dataset.state = s;
  const z = SIZES[s]();
  sw.setTarget(z.w);
  sh.setTarget(z.h);
  energy.setTarget(busy ? 1 : 0);
  if (s !== 'answer') input.style.height = '';
  input.disabled = (s === 'loading');
  input.placeholder = s === 'loading' ? 'Pensando…' : 'Pregunta algo…';
  if (s === 'input' && focus) setTimeout(() => input.focus(), 140);
}

function addMsg(kind, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + kind;
  d.textContent = text;
  answerEl.appendChild(d);
  answerEl.scrollTop = answerEl.scrollHeight;
  return d;
}

function refreshSend() { sendBtn.disabled = busy || !input.value.trim(); }

function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  lastQuery = text;
  voiceActive = false;
  addMsg('user', text);
  botMsg = addMsg('bot wait', '…');
  input.value = '';
  refreshSend();
  setState(state === 'answer' ? 'answer' : 'loading');   // Estado 3: las ondas se aceleran (energy -> 1)
  energy.setTarget(1);
  Android.send(text);
}

const ERRORS = {
  LOGIN_REQUIRED: 'Inicia sesión en Google desde la app (botón 1) y vuelve a intentarlo.',
  INPUT_NOT_FOUND: 'No encuentro el cuadro de texto de Gemini. La web pudo cambiar: revisa los selectores en gemini_bridge.js.',
  TIMEOUT: 'La respuesta tardó demasiado.'
};

// Android -> JS  (texto limpio extraído del DOM de Gemini)
window.onAssistantChunk = function (text, done, error) {
  if (!botMsg) botMsg = addMsg('bot', '');
  const nearBottom = answerEl.scrollHeight - answerEl.scrollTop - answerEl.clientHeight < 60;
  if (error && !text) {
    botMsg.className = 'msg err';
    botMsg.textContent = ERRORS[error] || ('Error: ' + error);
  } else if (text) {
    botMsg.className = 'msg bot';
    botMsg.textContent = text;
  }
  if (state === 'loading' && (text || error)) setState('answer');    // Estado 4: se despliega la respuesta
  if (nearBottom) answerEl.scrollTop = answerEl.scrollHeight;
  if (done && error && !text && lastQuery) Android.openSearch(lastQuery);   // respaldo: abre Google con la búsqueda
  if (done) {
    busy = false; botMsg = null;
    energy.setTarget(0);
    input.disabled = false;
    refreshSend();
  }
};

window.siriReset = function () { if (!busy) { voiceActive = false; input.value = ''; refreshSend(); setState('bubble'); } };

// Voz (Android -> JS): solo si la cápsula no está expandida. Se transcribe en vivo y se envía como un mensaje escrito.
window.onVoicePartial = function (text) {
  if (busy || !text) return;
  if (state !== 'bubble' && !voiceActive) return;
  voiceActive = true;
  input.value = text; refreshSend();
  if (state === 'bubble') setState('input', false);      // sin foco: no abre el teclado
};
window.onVoiceFinal = function (text) {
  if (busy || !text) return;
  if (state !== 'bubble' && !voiceActive) return;
  input.value = text;
  send();
};
window.onVoiceEnd = function () {                         // silencio / error sin resultado
  if (voiceActive && !busy) { voiceActive = false; input.value = ''; refreshSend(); setState('bubble'); }
};

island.addEventListener('click', () => { if (state === 'bubble') { Android.stopListening(); setState('input'); } });
input.addEventListener('focus', () => { if (voiceActive) { voiceActive = false; Android.stopListening(); } });
document.addEventListener('pointerdown', e => { if (!island.contains(e.target)) Android.close(); });
sendBtn.addEventListener('click', send);
input.addEventListener('input', () => {
  refreshSend();
  if (state === 'answer') { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 88) + 'px'; }
});
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H); U.u_resolution.value.set(W, H);
  const z = SIZES[state](); sw.setTarget(z.w); sh.setTarget(z.h);
});

// Modo prueba en navegador de escritorio (sin Android)
if (!window.Android) {
  window.Android = {
    close() { setState('bubble'); },
    stopListening() {},
    openSearch(q) { window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank'); },
    send(t) {
      const demo = 'Respuesta de prueba a: "' + t + '"\n\n' + Array.from({ length: 14 }, (_, i) => 'Línea ' + (i + 1) + ' de texto para comprobar el scroll de la tarjeta.').join('\n');
      let i = 0;
      setTimeout(function tick() {
        i = Math.min(demo.length, i + 18);
        window.onAssistantChunk(demo.slice(0, i), i >= demo.length, '');
        if (i < demo.length) setTimeout(tick, 120);
      }, 1500);
    }
  };
}

// ---------------------------------------------------------------------
//  Bucle de render
// ---------------------------------------------------------------------
let waveFadeTimer = 0, waveIntroTimer = 0, waveTime = 0;
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = clock.getDelta();
  const w = sw.update(dt), h = sh.update(dt), en = energy.update(dt);

  // posición/tamaño del contenido DOM = misma forma que el cristal
  const rr = Math.min(Math.min(w, h) / 2, 30);
  const sig = w.toFixed(2) + '|' + h.toFixed(2) + '|' + W;
  if (sig !== frame.sig) {
    frame.sig = sig;
    island.style.width = w + 'px';
    island.style.height = h + 'px';
    island.style.transform = 'translate(' + ((W - w) / 2) + 'px,' + TOP + 'px)';
    island.style.borderRadius = rr + 'px';
  }

  U.u_half.value.set(w / 2, h / 2);
  U.u_center.value.set(W / 2, TOP + h / 2);
  U.u_radius.value = rr;
  U.u_energy.value = Math.max(0, en);

  // las ondas siempre activas (Estado 1), más rápidas cuando energy -> 1
  waveFadeTimer = Math.min(waveFadeTimer + dt, PARAMS.waveFadeDuration);
  if (waveFadeTimer >= PARAMS.waveFadeDuration) waveIntroTimer = Math.min(waveIntroTimer + dt, PARAMS.waveIntroDuration);
  waveTime += dt * PARAMS.speed * (1 + PARAMS.energyBoost * Math.max(0, en));
  U.u_waveFade.value = smoothEase(waveFadeTimer / PARAMS.waveFadeDuration);
  U.u_waveIntro.value = waveIntroTimer / PARAMS.waveIntroDuration;
  U.u_time.value = waveTime;

  renderer.render(scene, camera);
}
setState('bubble');
frame();
