/* ============================================================
 *  VAR Touch Sensor Graph  –  script.js
 * ============================================================ */

(function () {
  'use strict';

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  var config = {
    duration: 6,
    touches: []
  };

  var canvas, ctx;
  var animationId = null;
  var waveformData = null;
  var presentTime = 0;       // the "present moment" (s) sitting on the centre playhead
  var isAnimating = false;
  var SAMPLE_RATE = 200;     // samples per second
  var touchCounter = 0;

  // GIF export settings
  var EXPORT_FPS       = 25;      // frames per second in the exported GIF
  var EXPORT_MAX_WIDTH = 720;     // cap output width (px) to keep file size sane
  var GRASS_BG         = '#4c7a32'; // fills the transparent frame around the panel
  var isExporting      = false;

  // ----------------------------------------------------------
  // Layout constants — derived by measuring the reference VAR
  // broadcast image (grid area 457x138 px, aspect 3.31:1).
  // ----------------------------------------------------------
  var GRID_COLS      = 36;    // vertical cells  (~12px spacing in source)
  var GRID_ROWS      = 11;    // horizontal cells
  var GRID_MAJOR     = 4;     // heavy gridline every N cells (~48px in source)
  var BASELINE_FRAC  = 0.80;  // resting waveform line, from top of panel
  var TOUCH_COLS     = 7;     // a touch spans ~7 columns  (0.195 * width)
  var PEAK_GAIN      = 0.53;  // intensity 0.9 -> ~0.48 panel-height peak (as measured)

  // Fixed horizontal time scale. Each grid column represents a constant number
  // of seconds, independent of the configured duration, so the trace always
  // scrolls at the same speed. A touch therefore keeps a constant on-screen
  // width and enters from the right edge, reaching the centre playhead exactly
  // at its configured time — no matter how long the total timeline is.
  var VISIBLE_SECONDS = 6;                          // seconds shown across the panel width
  var SECONDS_PER_COL = VISIBLE_SECONDS / GRID_COLS;

  // Normalized touch envelope traced from the reference waveform.
  // u = position across the touch (0..1); a = amplitude (0..1, peak = 1).
  // Captures the sharp attack, jagged crest and stepped decaying tail.
  var TOUCH_TEMPLATE = [
    [0.000, 0.000], [0.057, 0.030], [0.113, 0.440], [0.170, 0.850],
    [0.226, 0.970], [0.283, 1.000], [0.339, 0.965], [0.396, 0.920],
    [0.457, 0.895], [0.513, 0.800], [0.570, 0.715], [0.626, 0.715],
    [0.683, 0.635], [0.739, 0.485], [0.796, 0.255], [0.857, 0.210],
    [0.913, 0.245], [1.000, 0.000]
  ];
  var TOUCH_PEAK_U = 0.283;   // where the crest sits within the template

  // Interpolate the template at position u (0..1).
  function touchEnvelope(u) {
    if (u <= 0 || u >= 1) return 0;
    var t = TOUCH_TEMPLATE;
    for (var i = 1; i < t.length; i++) {
      if (u <= t[i][0]) {
        var f = (u - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return t[i - 1][1] + f * (t[i][1] - t[i - 1][1]);
      }
    }
    return 0;
  }

  // ----------------------------------------------------------
  // Bootstrap
  // ----------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    canvas = document.getElementById('graph-canvas');
    ctx    = canvas.getContext('2d');

    // Resize canvas to fill its container
    resizeCanvas();
    var ro = new ResizeObserver(function () {
      resizeCanvas();
      if (waveformData) {
        redraw();
      } else {
        drawEmptyGraph();
      }
    });
    ro.observe(canvas.parentElement);

    // Wire up buttons
    document.getElementById('btn-add-touch').addEventListener('click', function () {
      appendTouchRow(null, null);
    });
    document.getElementById('btn-generate').addEventListener('click', onGenerate);
    document.getElementById('btn-replay').addEventListener('click', onReplay);
    document.getElementById('btn-export-gif').addEventListener('click', onExportGif);
    document.getElementById('btn-share').addEventListener('click', onShare);
    document.getElementById('btn-copy').addEventListener('click', onCopy);

    // Load from URL if present, otherwise show a demo that mirrors the
    // reference broadcast image: one touch near 72% of the timeline.
    var fromURL = decodeFromURL();
    if (fromURL) {
      config = fromURL;
      populateForm();
      startGenerate();
    } else {
      config = { duration: 6, touches: [{ time: 4.32, intensity: 0.9 }] };
      populateForm();
      startGenerate();
    }
  });

  // ----------------------------------------------------------
  // Canvas sizing (HiDPI aware)
  // ----------------------------------------------------------
  var dpr = 1;
  var cssW = 0, cssH = 0;

  function resizeCanvas() {
    dpr  = window.devicePixelRatio || 1;
    // The canvas fills its wrapper via CSS (position:absolute; inset:0), so we
    // read the size flexbox already gave it. We must NOT write canvas.style
    // width/height here: the canvas would otherwise feed its own height back
    // into the parent's layout, and the ResizeObserver watching that parent
    // would re-trigger this function endlessly (the graph "grows forever" bug).
    cssW = Math.max(1, Math.floor(canvas.clientWidth));
    cssH = Math.max(1, Math.floor(canvas.clientHeight));
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Map logical (CSS px) drawing coordinates onto the HiDPI backing store.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ----------------------------------------------------------
  // Form helpers
  // ----------------------------------------------------------
  function appendTouchRow(time, intensity) {
    touchCounter++;
    var list  = document.getElementById('touches-list');
    var noMsg = document.getElementById('no-touches');
    if (noMsg) noMsg.remove();

    var idx = touchCounter;

    var item = document.createElement('div');
    item.className = 'touch-item';
    item.dataset.id = idx;
    item.setAttribute('role', 'listitem');

    var tVal = (time !== null && time !== undefined) ? time : '';
    var iVal = (intensity !== null && intensity !== undefined) ? intensity : 0.8;

    item.innerHTML =
      '<span class="touch-number">#' + idx + '</span>' +
      '<div class="touch-fields">' +
        '<div class="touch-field">' +
          '<label for="t-time-' + idx + '">Time (s)</label>' +
          '<input id="t-time-' + idx + '" type="number" class="touch-time" ' +
                 'min="0" step="0.1" value="' + tVal + '" placeholder="0.0">' +
        '</div>' +
        '<div class="touch-field">' +
          '<label for="t-int-' + idx + '">Intensity</label>' +
          '<input id="t-int-' + idx + '" type="number" class="touch-intensity" ' +
                 'min="0" max="1" step="any" value="' + iVal + '" placeholder="0.8">' +
        '</div>' +
      '</div>' +
      '<button class="touch-delete" title="Remove touch" aria-label="Remove touch event">&#10005;</button>';

    item.querySelector('.touch-delete').addEventListener('click', function () {
      item.remove();
      if (document.querySelectorAll('.touch-item').length === 0) {
        showNoTouches();
      }
    });

    list.appendChild(item);
  }

  function showNoTouches() {
    var list = document.getElementById('touches-list');
    var div  = document.createElement('div');
    div.id = 'no-touches';
    div.className = 'no-touches';
    div.innerHTML = 'No touch events added yet.<br>Click <strong>+ Add Touch</strong> to begin.';
    list.appendChild(div);
  }

  function readForm() {
    config.duration = Math.max(1, parseFloat(document.getElementById('duration').value) || 10);
    config.touches  = [];
    document.querySelectorAll('.touch-item').forEach(function (item) {
      var t = parseFloat(item.querySelector('.touch-time').value);
      var i = parseFloat(item.querySelector('.touch-intensity').value);
      if (!isNaN(t) && !isNaN(i) && i > 0) {
        config.touches.push({
          time: Math.max(0, Math.min(config.duration, t)),
          intensity: Math.min(1, i)
        });
      }
    });
    config.touches.sort(function (a, b) { return a.time - b.time; });
  }

  function populateForm() {
    document.getElementById('duration').value = config.duration;
    var list = document.getElementById('touches-list');
    list.innerHTML = '';
    touchCounter = 0;
    if (!config.touches || config.touches.length === 0) {
      showNoTouches();
    } else {
      config.touches.forEach(function (t) {
        appendTouchRow(t.time, t.intensity);
      });
    }
  }

  // ----------------------------------------------------------
  // Generate / replay
  // ----------------------------------------------------------
  function onGenerate() {
    readForm();
    startGenerate();
  }

  function onReplay() {
    if (!waveformData) return;
    stopAnimation();
    presentTime = 0;
    setStatus('active', 'Replaying\u2026');
    document.getElementById('btn-replay').disabled = true;
    runAnimation();
  }

  function startGenerate() {
    stopAnimation();
    waveformData  = buildWaveform();
    presentTime   = 0;
    updateShareURL();
    setStatus('active', 'Replaying\u2026');
    document.getElementById('btn-replay').disabled = true;
    if (!isExporting) document.getElementById('btn-export-gif').disabled = false;
    runAnimation();
  }

  // ----------------------------------------------------------
  // Waveform data generation
  // ----------------------------------------------------------
  function buildWaveform() {
    var n    = Math.ceil(config.duration * SAMPLE_RATE);
    var data = new Float32Array(n);

    // Lightweight seeded PRNG for deterministic baseline noise
    var seed = 0x9e3779b9;
    function rand() {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) / 0xffffffff) - 0.5;
    }

    // Baseline: very subtle sensor noise along the resting line
    for (var i = 0; i < n; i++) {
      data[i] = rand() * 0.012;
    }

    // Each touch is the measured envelope, TOUCH_COLS grid columns wide,
    // with its crest aligned to the touch time. The width is a fixed number of
    // seconds (constant time scale) so touches look identical at any duration.
    var width = TOUCH_COLS * SECONDS_PER_COL;      // touch "wavelength" (s), constant

    config.touches.forEach(function (touch) {
      var start = touch.time - TOUCH_PEAK_U * width;   // template u=0
      var s0 = Math.max(0, Math.floor(start * SAMPLE_RATE));
      var s1 = Math.min(n, Math.ceil((start + width) * SAMPLE_RATE));
      for (var j = s0; j < s1; j++) {
        var u = (j / SAMPLE_RATE - start) / width;
        data[j] += touchEnvelope(u) * touch.intensity * PEAK_GAIN;
      }
    });

    // Clamp to the drawable range (headroom above baseline)
    var head = BASELINE_FRAC;         // room from baseline up to the top
    var foot = 1 - BASELINE_FRAC;     // room from baseline down
    for (var k = 0; k < n; k++) {
      data[k] = Math.max(-foot, Math.min(head, data[k]));
    }
    return data;
  }

  // ----------------------------------------------------------
  // Animation loop
  // ----------------------------------------------------------
  // The "present moment" sweeps from the start of the timeline to its end.
  // The waveform is drawn in a window centred on that moment, so recorded
  // peaks scroll in from the right (future), cross the centre playhead
  // (present), and recede to the left (past) — the VAR replay look.
  function runAnimation() {
    var startTime = null;
    // Play back in real time: the present moment advances one second per real
    // second, so a touch configured at time T crosses the centre playhead
    // exactly T seconds into the replay, and the whole timeline takes
    // config.duration seconds to sweep past.
    var totalMs = Math.max(1, config.duration) * 1000;

    function frame(timestamp) {
      if (startTime === null) startTime = timestamp;
      var elapsed  = timestamp - startTime;
      var progress = Math.min(elapsed / totalMs, 1);
      presentTime  = progress * config.duration;
      redraw();
      if (progress < 1) {
        animationId = requestAnimationFrame(frame);
      } else {
        animationId = null;
        isAnimating = false;
        setStatus('done', 'Complete');
        document.getElementById('btn-replay').disabled = false;
      }
    }
    isAnimating = true;
    animationId = requestAnimationFrame(frame);
  }

  function stopAnimation() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // ----------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------
  // Geometry of the centered graphic: a colored frame around a navy grid,
  // letterboxed to the reference aspect ratio (GRID_COLS : GRID_ROWS).
  function panelRect(W, H) {
    var margin = Math.round(Math.min(W, H) * 0.04) + 2;
    var availW = W - margin * 2;
    var availH = H - margin * 2;
    var frame  = Math.max(7, Math.round(availH * 0.075));
    var aspect = GRID_COLS / GRID_ROWS;
    var gw = availW - 2 * frame;
    var gh = availH - 2 * frame;
    if (gw / gh > aspect) { gw = gh * aspect; } else { gh = gw / aspect; }
    var ow = gw + 2 * frame, oh = gh + 2 * frame;
    var ox = (W - ow) / 2, oy = (H - oh) / 2;
    return {
      frame: frame,
      ox: ox, oy: oy, ow: ow, oh: oh,
      gx: ox + frame, gy: oy + frame, gw: gw, gh: gh
    };
  }

  function redraw() {
    drawScene(presentTime);
  }

  function drawEmptyGraph() {
    drawScene(config.duration / 2);
  }

  function drawScene(tNow) {
    // Reset the transform and derive the logical drawing size from the backing
    // store on every frame. This keeps drawing consistent with the canvas size
    // even if a resize (which clears the transform) races with the animation.
    dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cssW = Math.max(1, canvas.width  / dpr);
    var H = cssH = Math.max(1, canvas.height / dpr);
    var p = panelRect(W, H);

    ctx.clearRect(0, 0, W, H);          // let the grass field show around it
    drawPanelBackground(p);
    drawGrid(p);
    drawWave(p, tNow);
    drawFrame(p);
    drawPlayhead(p);
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawPanelBackground(p) {
    ctx.save();
    var g = ctx.createLinearGradient(0, p.oy, 0, p.oy + p.oh);
    g.addColorStop(0, '#16241f');
    g.addColorStop(1, '#0b1517');
    ctx.fillStyle = g;
    roundRectPath(p.ox, p.oy, p.ow, p.oh, p.frame * 0.9);
    ctx.fill();
    ctx.restore();
  }

  function drawGrid(p) {
    ctx.save();
    roundRectPath(p.gx, p.gy, p.gw, p.gh, 2);
    ctx.clip();

    // vertical lines
    for (var c = 0; c <= GRID_COLS; c++) {
      var x = p.gx + (c / GRID_COLS) * p.gw;
      var major = (c % GRID_MAJOR === 0);
      ctx.strokeStyle = major ? 'rgba(126,214,196,0.16)' : 'rgba(126,214,196,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, p.gy);
      ctx.lineTo(Math.round(x) + 0.5, p.gy + p.gh);
      ctx.stroke();
    }
    // horizontal lines
    for (var r = 0; r <= GRID_ROWS; r++) {
      var y = p.gy + (r / GRID_ROWS) * p.gh;
      var majorR = (r % GRID_MAJOR === 0);
      ctx.strokeStyle = majorR ? 'rgba(126,214,196,0.16)' : 'rgba(126,214,196,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.gx, Math.round(y) + 0.5);
      ctx.lineTo(p.gx + p.gw, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // Corner-kick arc, part of the field boundary: centred on the bottom-left
    // corner where the left and bottom edges meet, curving into the pitch.
    var cornerY = p.gy + p.gh;
    ctx.strokeStyle = 'rgba(188,181,219,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.gx, cornerY, p.gh * 0.13, -Math.PI / 2, 0);
    ctx.stroke();

    ctx.restore();
  }

  // Draw the sensor trace inside a time window centred on the present moment.
  // The horizontal baseline always spans the full width — as if the game were
  // already running — with recorded touches appearing at their true time
  // position: to the right of the centre = future, at the centre = now, to the
  // left = past. `tNow` is the present-moment time (seconds) at the playhead.
  function drawWave(p, tNow) {
    var baseY         = p.gy + BASELINE_FRAC * p.gh;
    var windowSeconds = VISIBLE_SECONDS;          // constant window => constant scroll speed
    var leftTime      = tNow - windowSeconds / 2; // time at the left grid edge

    function Y(v) { return baseY - v * p.gh; }

    // Sample the recorded waveform at an arbitrary time (seconds), with linear
    // interpolation. Returns 0 (flat baseline) outside the recorded range so
    // the horizontal line is continuous across the whole width.
    function sampleAt(t) {
      if (!waveformData || t < 0 || t >= config.duration) return 0;
      var f  = t * SAMPLE_RATE;
      var i0 = Math.floor(f);
      if (i0 < 0 || i0 >= waveformData.length) return 0;
      var i1 = Math.min(waveformData.length - 1, i0 + 1);
      var fr = f - i0;
      return waveformData[i0] * (1 - fr) + waveformData[i1] * fr;
    }

    ctx.save();
    roundRectPath(p.gx, p.gy, p.gw, p.gh, 2);
    ctx.clip();

    // One point per horizontal pixel keeps the line smooth at any width.
    var steps = Math.max(2, Math.round(p.gw));
    function tracePath() {
      ctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var frac = s / steps;
        var x = p.gx + frac * p.gw;
        var y = Y(sampleAt(leftTime + frac * windowSeconds));
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }

    // glow pass
    ctx.shadowColor = '#7ff7df';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = 'rgba(147,247,223,0.35)';
    ctx.lineWidth   = 4;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    tracePath();
    ctx.stroke();

    // core line
    ctx.shadowBlur  = 5;
    ctx.strokeStyle = '#e9fff9';
    ctx.lineWidth   = 1.7;
    tracePath();
    ctx.stroke();

    ctx.restore();
  }

  // Colored segmented frame (border) around the grid — the broadcast look.
  function drawFrame(p) {
    var LAV = '#a99fd0', VIO = '#5b4fc4', ORA = '#cf7d3f', LIM = '#c3e04d';
    var t = p.frame;
    var x0 = p.ox, y0 = p.oy, w = p.ow, h = p.oh;
    // segment boundaries along the width (measured: 0.31 and 0.72)
    var b1 = x0 + w * 0.31;
    var b2 = x0 + w * 0.72;

    ctx.save();
    // left & right vertical edges
    ctx.fillStyle = LAV; ctx.fillRect(x0, y0, t, h);
    ctx.fillStyle = LIM; ctx.fillRect(x0 + w - t, y0, t, h);
    // top edge: lavender | violet | lime
    ctx.fillStyle = LAV; ctx.fillRect(x0, y0, b1 - x0, t);
    ctx.fillStyle = VIO; ctx.fillRect(b1, y0, b2 - b1, t);
    ctx.fillStyle = LIM; ctx.fillRect(b2, y0, x0 + w - b2, t);
    // bottom edge: lavender | orange | lime
    var yb = y0 + h - t;
    ctx.fillStyle = LAV; ctx.fillRect(x0, yb, b1 - x0, t);
    ctx.fillStyle = ORA; ctx.fillRect(b1, yb, b2 - b1, t);
    ctx.fillStyle = LIM; ctx.fillRect(b2, yb, x0 + w - b2, t);

    // subtle outer highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRectPath(x0 + 0.5, y0 + 0.5, w - 1, h - 1, p.frame * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  // Central white playhead / scrubber line.
  function drawPlayhead(p) {
    var x = p.ox + p.ow / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur  = 4;
    ctx.strokeStyle = '#f2fbff';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(x, p.oy);
    ctx.lineTo(x, p.oy + p.oh);
    ctx.stroke();
    ctx.restore();
  }

  // ----------------------------------------------------------
  // Status indicator
  // ----------------------------------------------------------
  function setStatus(type, text) {
    var dot  = document.getElementById('status-dot');
    var span = document.getElementById('status-text');
    dot.className = 'status-dot' + (type ? ' ' + type : '');
    if (span) span.textContent = text;
  }

  // ----------------------------------------------------------
  // URL encoding / decoding
  // ----------------------------------------------------------
  function encodeToURL() {
    var json    = JSON.stringify(config);
    var encoded = btoa(unescape(encodeURIComponent(json)));
    var url     = new URL(window.location.href);
    url.search  = '';
    url.hash    = '';
    url.searchParams.set('data', encoded);
    return url.toString();
  }

  function decodeFromURL() {
    try {
      var params  = new URLSearchParams(window.location.search);
      var encoded = params.get('data');
      if (!encoded) return null;
      var json = decodeURIComponent(escape(atob(encoded)));
      var obj  = JSON.parse(json);
      // Basic validation
      if (typeof obj.duration !== 'number' || !Array.isArray(obj.touches)) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function updateShareURL() {
    var input = document.getElementById('share-url');
    if (input) input.value = encodeToURL();
  }

  // ----------------------------------------------------------
  // Share / copy
  // ----------------------------------------------------------
  function onShare() {
    readForm();
    var url = encodeToURL();
    // Push the encoded state to browser history (no page reload)
    window.history.replaceState(null, '', url);
    document.getElementById('share-url').value = url;
    showToast('URL updated \u2014 copy it below!');
  }

  function onCopy() {
    var input = document.getElementById('share-url');
    if (!input || !input.value) {
      showToast('Generate a graph first.');
      return;
    }
    var text = input.value;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('URL copied to clipboard!');
      }).catch(function () {
        fallbackCopy(input);
      });
    } else {
      fallbackCopy(input);
    }
  }

  function fallbackCopy(input) {
    input.select();
    try {
      document.execCommand('copy');
      showToast('URL copied!');
    } catch (e) {
      showToast('Select the URL and copy manually.');
    }
    if (window.getSelection) window.getSelection().removeAllRanges();
  }

  // ----------------------------------------------------------
  // Toast notification
  // ----------------------------------------------------------
  var toastTimer = null;

  function showToast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 3000);
  }

  // ----------------------------------------------------------
  // GIF export
  // ----------------------------------------------------------
  // The animation is fully deterministic — every frame is drawScene(t) for a
  // given time — so we render the timeline frame by frame offline (as fast as
  // the CPU allows) and hand each frame to gif.js for encoding. No real-time
  // screen capture needed.
  function onExportGif() {
    if (isExporting) return;
    if (!waveformData) { showToast('Generate a graph first.'); return; }
    if (typeof GIF === 'undefined') {
      showToast('GIF encoder failed to load.');
      return;
    }

    isExporting = true;
    stopAnimation();
    isAnimating = false;

    var exportBtn = document.getElementById('btn-export-gif');
    var genBtn    = document.getElementById('btn-generate');
    var replayBtn = document.getElementById('btn-replay');
    exportBtn.disabled = true;
    genBtn.disabled    = true;
    replayBtn.disabled = true;

    setStatus('active', 'Rendering GIF\u2026');

    // Defer so the status text repaints before the (blocking) frame capture.
    setTimeout(function () {
      renderGif(exportBtn, genBtn, replayBtn);
    }, 30);
  }

  function renderGif(exportBtn, genBtn, replayBtn) {
    var savedPresent = presentTime;

    // Output size: cap the width for a reasonable file size, keep the aspect.
    var srcW  = canvas.width;
    var srcH  = canvas.height;
    var outW  = Math.min(srcW, EXPORT_MAX_WIDTH);
    var scale = outW / srcW;
    var outH  = Math.max(1, Math.round(srcH * scale));

    var tmp = document.createElement('canvas');
    tmp.width  = outW;
    tmp.height = outH;
    var tctx = tmp.getContext('2d');

    var duration    = Math.max(0.1, config.duration);
    var totalFrames = Math.max(2, Math.round(duration * EXPORT_FPS));
    var delay       = Math.round(1000 / EXPORT_FPS);

    var gif = new GIF({
      workers: 2,
      quality: 10,
      width: outW,
      height: outH,
      repeat: 0,            // 0 = loop forever
      workerScript: new URL('vendor/gif.worker.js', document.baseURI).href
    });

    // Capture frames at evenly spaced times over [0, duration) so the loop is
    // seamless. Each frame is rendered on the real canvas, then downscaled onto
    // a grass-filled temp canvas (the panel has transparent rounded corners).
    for (var i = 0; i < totalFrames; i++) {
      var t = (i / totalFrames) * duration;
      drawScene(t);
      tctx.fillStyle = GRASS_BG;
      tctx.fillRect(0, 0, outW, outH);
      tctx.drawImage(canvas, 0, 0, srcW, srcH, 0, 0, outW, outH);
      gif.addFrame(tctx, { copy: true, delay: delay });
    }

    gif.on('progress', function (ratio) {
      setStatus('active', 'Encoding GIF\u2026 ' + Math.round(ratio * 100) + '%');
    });

    gif.on('finished', function (blob) {
      downloadBlob(blob, gifFileName());
      finishExport(exportBtn, genBtn, replayBtn, savedPresent);
      setStatus('done', 'GIF ready');
      showToast('GIF downloaded (' + formatBytes(blob.size) + ').');
    });

    gif.on('abort', function () {
      finishExport(exportBtn, genBtn, replayBtn, savedPresent);
      setStatus('done', 'GIF cancelled');
    });

    try {
      gif.render();
    } catch (e) {
      finishExport(exportBtn, genBtn, replayBtn, savedPresent);
      setStatus('done', 'GIF failed');
      showToast('Could not encode GIF.');
    }
  }

  function finishExport(exportBtn, genBtn, replayBtn, savedPresent) {
    isExporting = false;
    exportBtn.disabled = false;
    genBtn.disabled    = false;
    replayBtn.disabled = false;
    // Restore the on-screen graph to its pre-export frame.
    presentTime = savedPresent;
    redraw();
  }

  function gifFileName() {
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return 'var-touch-graph-' + stamp + '.gif';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

})();
