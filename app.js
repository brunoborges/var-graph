/* ─── State ─────────────────────────────────────── */
let touchSeq    = 0;
let config      = null;   // { duration, touches }
let currentTime = 0;
let isPlaying   = false;
let animId      = null;
let lastTS      = null;
let speed       = 1;

/* ─── Signal model ──────────────────────────────── */
//  Each touch produces a damped sinusoidal burst
//    f(t) = A · sin(2π·freq·(t−t₀)) · exp(−k·(t−t₀)²)
//  Parameters chosen for a visually compelling broadcast look.
const FREQ  = 9;   // oscillation frequency (Hz)
const DECAY = 16;  // Gaussian decay rate (larger → tighter burst)

function touchSignal(t, t0, intensity) {
  const dt = t - t0;
  const A  = intensity / 100;
  return A * Math.sin(2 * Math.PI * FREQ * dt) * Math.exp(-DECAY * dt * dt);
}

function computeSignal(t, touches) {
  return touches.reduce((sum, touch) => sum + touchSignal(t, touch.time, touch.intensity), 0);
}

/* ─── Touch UI ──────────────────────────────────── */
function addTouch(timeVal = '', intensityVal = 60, labelVal = '') {
  touchSeq++;
  const id  = touchSeq;
  const row = document.createElement('div');
  row.className = 'touch-row';
  row.id = `tr-${id}`;
  row.innerHTML = `
    <span class="touch-badge">${id}</span>
    <div class="field">
      <label>Time (s)</label>
      <input type="number" class="t-time" value="${timeVal}" min="0" step="0.1">
    </div>
    <div class="field">
      <label>Intensity (1–100)</label>
      <input type="number" class="t-intensity" value="${intensityVal}" min="1" max="100">
    </div>
    <div class="field">
      <label>Label (optional)</label>
      <input type="text" class="t-label" value="${labelVal}" placeholder="e.g. Handball">
    </div>
    <button class="btn-remove" title="Remove" onclick="removeTouchRow(${id})">✕</button>`;
  document.getElementById('touchList').appendChild(row);
}

function removeTouchRow(id) {
  const el = document.getElementById(`tr-${id}`);
  if (el) el.remove();
}

function getTouches() {
  return Array.from(document.querySelectorAll('.touch-row'))
    .map(row => ({
      time:      parseFloat(row.querySelector('.t-time').value)      || 0,
      intensity: parseFloat(row.querySelector('.t-intensity').value) || 50,
      label:     row.querySelector('.t-label').value.trim()
    }))
    .sort((a, b) => a.time - b.time);
}

/* ─── Graph rendering ───────────────────────────── */
function getCanvas() { return document.getElementById('graphCanvas'); }

// Precomputed samples (filled on generateGraph)
let samples    = [];
let maxAmp     = 1;
const N_SAMPLES = 3000;

function generateGraph() {
  stopPlayback();
  const duration = Math.max(0.5, parseFloat(document.getElementById('duration').value) || 6);
  const touches  = getTouches();
  config = { duration, touches };

  // Pre-compute signal samples
  samples = new Float32Array(N_SAMPLES + 1);
  maxAmp  = 0.001;
  for (let i = 0; i <= N_SAMPLES; i++) {
    const t = (i / N_SAMPLES) * duration;
    const v = computeSignal(t, touches);
    samples[i] = v;
    if (Math.abs(v) > maxAmp) maxAmp = Math.abs(v);
  }

  currentTime = 0;
  drawFrame(1); // show full graph immediately
}

function drawFrame(progress) {
  if (!config) return;
  const canvas = getCanvas();
  const ctx    = canvas.getContext('2d');
  const { duration, touches } = config;

  // Physical pixel size
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement.clientWidth - 40;
  const cssH = 220;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  ctx.scale(dpr, dpr);

  const W = cssW, H = cssH;
  const ML = 54, MR = 16, MT = 28, MB = 34;
  const GW = W - ML - MR;
  const GH = H - MT - MB;
  const CY = MT + GH / 2;

  /* background */
  ctx.fillStyle = '#040d18';
  ctx.fillRect(0, 0, W, H);

  /* subtle grid */
  ctx.strokeStyle = '#0c1e30';
  ctx.lineWidth   = 1;
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const y = MT + GH * f;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + GW, y); ctx.stroke();
  });

  const tStep = smartTimeStep(duration);
  ctx.font      = '11px monospace';
  ctx.fillStyle = '#2a5070';
  ctx.textAlign = 'center';
  for (let t = 0; t <= duration + 1e-9; t = +(t + tStep).toFixed(6)) {
    const x = ML + (t / duration) * GW;
    if (x > ML + GW + 1) break;
    ctx.strokeStyle = '#0c1e30';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, MT + GH); ctx.stroke();
    ctx.fillText(t.toFixed(tStep < 1 ? 1 : 0) + 's', x, H - MB + 16);
  }

  /* center baseline */
  ctx.strokeStyle = '#1a3a5a';
  ctx.lineWidth   = 1.2;
  ctx.beginPath(); ctx.moveTo(ML, CY); ctx.lineTo(ML + GW, CY); ctx.stroke();

  /* Y-axis label */
  ctx.save();
  ctx.font      = '10px monospace';
  ctx.fillStyle = '#2a5070';
  ctx.textAlign = 'center';
  ctx.translate(13, CY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('IMPACT', 0, 0);
  ctx.restore();

  /* touch markers */
  const progressTime = progress * duration;
  touches.forEach(touch => {
    if (touch.time > progressTime + 0.001) return;
    const tx = ML + (touch.time / duration) * GW;

    ctx.strokeStyle = 'rgba(255,215,0,0.25)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(tx, MT); ctx.lineTo(tx, MT + GH); ctx.stroke();
    ctx.setLineDash([]);

    if (touch.label) {
      ctx.font      = 'bold 10px Arial';
      ctx.fillStyle = 'rgba(255,215,0,0.75)';
      ctx.textAlign = 'center';
      ctx.fillText(touch.label, tx, MT - 8);
    }

    // touch dot on center line
    ctx.beginPath();
    ctx.arc(tx, CY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD700';
    ctx.fill();
  });

  /* waveform up to progressTime */
  const limitX = ML + progress * GW;
  const scale  = (GH / 2) * 0.82 / maxAmp;

  // fill path (gradient below/above center line)
  const fillGrad = ctx.createLinearGradient(0, MT, 0, MT + GH);
  fillGrad.addColorStop(0,   'rgba(255,215,0,0.12)');
  fillGrad.addColorStop(0.5, 'rgba(255,215,0,0.0)');
  fillGrad.addColorStop(1,   'rgba(255,215,0,0.12)');

  ctx.save();
  ctx.rect(ML, MT, limitX - ML, GH);
  ctx.clip();

  // fill
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= N_SAMPLES; i++) {
    const t = (i / N_SAMPLES) * duration;
    const x = ML + (t / duration) * GW;
    const y = CY - samples[i] * scale;
    if (!started) { ctx.moveTo(x, y); started = true; }
    else            ctx.lineTo(x, y);
  }
  ctx.lineTo(ML + GW, CY);
  ctx.lineTo(ML, CY);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // glow layers (outer → inner)
  [
    { lw: 10, alpha: 0.04 },
    { lw: 6,  alpha: 0.10 },
    { lw: 3,  alpha: 0.35 },
    { lw: 1.5,alpha: 0.90 },
  ].forEach(({ lw, alpha }) => {
    ctx.beginPath();
    started = false;
    for (let i = 0; i <= N_SAMPLES; i++) {
      const t = (i / N_SAMPLES) * duration;
      const x = ML + (t / duration) * GW;
      const y = CY - samples[i] * scale;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else            ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,215,0,${alpha})`;
    ctx.lineWidth   = lw;
    ctx.stroke();
  });

  ctx.restore();

  /* playback cursor */
  if (progress > 0 && progress < 1) {
    const cx = ML + progress * GW;
    ctx.strokeStyle = 'rgba(255,100,80,0.75)';
    ctx.lineWidth   = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, MT); ctx.lineTo(cx, MT + GH); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* graph border */
  ctx.strokeStyle = '#1a3352';
  ctx.lineWidth   = 1;
  ctx.strokeRect(ML, MT, GW, GH);

  /* time cursor label */
  if (progress > 0 && progress < 1) {
    const cx = ML + progress * GW;
    const elapsed = (progress * duration).toFixed(2);
    ctx.font      = '10px monospace';
    ctx.fillStyle = 'rgba(255,100,80,0.85)';
    ctx.textAlign = cx > ML + GW / 2 ? 'right' : 'left';
    ctx.fillText(elapsed + 's', cx + (ctx.textAlign === 'right' ? -4 : 4), MT + 12);
  }
}

function smartTimeStep(dur) {
  if (dur <= 5)  return 0.5;
  if (dur <= 10) return 1;
  if (dur <= 20) return 2;
  if (dur <= 60) return 5;
  return 10;
}

/* ─── Playback ──────────────────────────────────── */
function togglePlay() {
  if (isPlaying) stopPlayback(); else startPlayback();
}

function startPlayback() {
  if (!config) return;
  if (currentTime >= config.duration) currentTime = 0;
  isPlaying = true;
  lastTS    = null;
  document.getElementById('playBtn').textContent = '⏸ Pause';
  animId = requestAnimationFrame(animLoop);
}

function stopPlayback() {
  isPlaying = false;
  document.getElementById('playBtn').textContent = '▶ Play';
  if (animId) { cancelAnimationFrame(animId); animId = null; }
}

function resetPlayback() {
  stopPlayback();
  currentTime = 0;
  if (config) drawFrame(0);
}

function animLoop(ts) {
  if (!isPlaying) return;
  if (!lastTS) lastTS = ts;
  const dt = (ts - lastTS) / 1000;
  lastTS = ts;
  currentTime += dt * speed;

  if (currentTime >= config.duration) {
    currentTime = config.duration;
    drawFrame(1);
    stopPlayback();
    return;
  }
  drawFrame(currentTime / config.duration);
  animId = requestAnimationFrame(animLoop);
}

/* ─── URL Sharing ───────────────────────────────── */
function encodeGraphData(data) {
  const json = JSON.stringify(data);
  // btoa needs a binary string; encodeURIComponent handles unicode
  return btoa(encodeURIComponent(json)
    .replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeGraphData(encoded) {
  // Reverse base64url → base64 → binary string → URI decode → JSON
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const json = decodeURIComponent(
    Array.from(binary).map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
  return JSON.parse(json);
}

function getShareURL() {
  const duration = Math.max(0.5, parseFloat(document.getElementById('duration').value) || 6);
  const touches  = getTouches();
  const data     = { duration, touches };
  const encoded  = encodeGraphData(data);
  const url      = new URL(window.location.href.split('?')[0]);
  url.searchParams.set('d', encoded);
  return url.toString();
}

function shareGraph() {
  const url = getShareURL();
  const box = document.getElementById('shareUrlBox');
  const inp = document.getElementById('shareUrlInput');
  inp.value = url;
  box.classList.add('visible');
  copyShareUrl(url);
}

function copyShareUrl(url) {
  const target = url || document.getElementById('shareUrlInput').value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(target).then(showToast).catch(() => fallbackCopy(target));
  } else {
    fallbackCopy(target);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); showToast(); } catch (_) {}
  document.body.removeChild(ta);
}

let toastTimer;
function showToast() {
  const t = document.getElementById('shareToast');
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 2500);
}

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const d = params.get('d');
  if (!d) return false;
  try {
    const data = decodeGraphData(d);
    // Set duration
    document.getElementById('duration').value = data.duration ?? 6;
    // Clear existing touch rows
    document.getElementById('touchList').innerHTML = '';
    touchSeq = 0;
    // Restore touches
    if (Array.isArray(data.touches)) {
      data.touches.forEach(t => addTouch(t.time ?? '', t.intensity ?? 60, t.label ?? ''));
    }
    return true;
  } catch (e) {
    console.warn('Could not load graph from URL:', e);
    return false;
  }
}

/* ─── Resize ────────────────────────────────────── */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (config) drawFrame(currentTime / config.duration);
  }, 80);
});

/* ─── Bootstrap ─────────────────────────────────── */
if (!loadFromURL()) {
  addTouch(1.5, 65, 'Touch 1');
  addTouch(3.2, 88, 'Handball');
  addTouch(4.8, 55, 'Touch 3');
}
generateGraph();
