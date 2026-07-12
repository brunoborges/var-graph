/* ============================================================
 *  VAR Touch Sensor Graph  –  script.js
 * ============================================================ */

(function () {
  'use strict';

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  var config = {
    duration: 10,
    touches: []
  };

  var canvas, ctx;
  var animationId = null;
  var waveformData = null;
  var animProgress = 0;      // current sample index being drawn
  var SAMPLE_RATE = 200;     // samples per second
  var touchCounter = 0;

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
    document.getElementById('btn-share').addEventListener('click', onShare);
    document.getElementById('btn-copy').addEventListener('click', onCopy);

    // Load from URL if present
    var fromURL = decodeFromURL();
    if (fromURL) {
      config = fromURL;
      populateForm();
      startGenerate();
    } else {
      drawEmptyGraph();
    }
  });

  // ----------------------------------------------------------
  // Canvas sizing (HiDPI aware)
  // ----------------------------------------------------------
  var dpr = 1;
  var cssW = 0, cssH = 0;

  function resizeCanvas() {
    dpr  = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    // Reserve ~14px top for graph header (already rendered in DOM above canvas)
    cssW = Math.max(1, Math.floor(rect.width  - 2));  // 1px padding each side
    cssH = Math.max(1, Math.floor(rect.height - 56)); // header + padding
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.scale(dpr, dpr);
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
                 'min="0.05" max="1" step="0.05" value="' + iVal + '" placeholder="0.8">' +
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
      if (!isNaN(t) && !isNaN(i)) {
        config.touches.push({
          time: Math.max(0, Math.min(config.duration, t)),
          intensity: Math.max(0.05, Math.min(1, i))
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
    animProgress = 0;
    setStatus('active', 'Recording\u2026');
    document.getElementById('btn-replay').disabled = true;
    runAnimation();
  }

  function startGenerate() {
    stopAnimation();
    waveformData  = buildWaveform();
    animProgress  = 0;
    updateShareURL();
    setStatus('active', 'Recording\u2026');
    document.getElementById('btn-replay').disabled = true;
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

    // Baseline: very subtle noise
    for (var i = 0; i < n; i++) {
      data[i] = rand() * 0.035;
    }

    // Touch spikes
    config.touches.forEach(function (touch) {
      var t0  = touch.time;
      var amp = touch.intensity;

      for (var j = 0; j < n; j++) {
        var t  = j / SAMPLE_RATE;
        var dt = t - t0;

        // Primary Gaussian spike (sharp: sigma ≈ 0.05 s)
        var sigma  = 0.05 + (1 - amp) * 0.03;
        var spike  = amp * Math.exp(-(dt * dt) / (2 * sigma * sigma));

        // Small pre-touch dip (like an ECG P-wave offset)
        var preDip = -0.1 * amp * Math.exp(-Math.pow(dt + sigma * 2, 2) / (2 * Math.pow(sigma * 0.7, 2)));

        // Post-touch rebound (slight damped oscillation)
        var rebound = -0.18 * amp * Math.exp(-Math.pow(dt - sigma * 1.8, 2) / (2 * Math.pow(sigma, 2)));

        data[j] += spike + preDip + rebound;
      }
    });

    // Clamp
    for (var k = 0; k < n; k++) {
      data[k] = Math.max(-1, Math.min(1, data[k]));
    }
    return data;
  }

  // ----------------------------------------------------------
  // Animation loop
  // ----------------------------------------------------------
  function runAnimation() {
    // Target animation duration: 4 s (clamped between 2 and 8)
    var animSecs = Math.max(2, Math.min(8, config.duration * 0.45));
    var totalFrames  = animSecs * 60;
    var samplesPerFrame = Math.max(1, waveformData.length / totalFrames);

    function frame() {
      animProgress = Math.min(animProgress + samplesPerFrame, waveformData.length);
      redraw();
      if (animProgress < waveformData.length) {
        animationId = requestAnimationFrame(frame);
      } else {
        animationId = null;
        setStatus('done', 'Complete');
        document.getElementById('btn-replay').disabled = false;
      }
    }
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
  function redraw() {
    drawWaveform(Math.floor(animProgress));
  }

  function drawEmptyGraph() {
    var W = cssW, H = cssH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030305';
    ctx.fillRect(0, 0, W, H);
    drawGrid(W, H, config.duration);
    drawCenterLine(W, H);
    drawTimeAxis(W, H, config.duration);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawWaveform(upTo) {
    var W    = cssW;
    var H    = cssH;
    var midY = H / 2;
    var amp  = H * 0.38;
    var dur  = config.duration;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030305';
    ctx.fillRect(0, 0, W, H);

    drawGrid(W, H, dur);
    drawCenterLine(W, H);

    if (!waveformData || upTo === 0) {
      drawTimeAxis(W, H, dur);
      return;
    }

    var total = waveformData.length;
    var pxPerSample = W / total;

    // -- glow pass (thick, dim) --
    ctx.save();
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = '#00d4ff33';
    ctx.lineWidth   = 4;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    for (var i = 0; i <= upTo && i < total; i++) {
      var x = i * pxPerSample;
      var y = midY - waveformData[i] * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // -- main line pass --
    ctx.save();
    ctx.shadowColor = '#00d4ff';
    ctx.shadowBlur  = 6;
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 1.6;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();
    for (var j = 0; j <= upTo && j < total; j++) {
      var xj = j * pxPerSample;
      var yj = midY - waveformData[j] * amp;
      if (j === 0) ctx.moveTo(xj, yj); else ctx.lineTo(xj, yj);
    }
    ctx.stroke();
    ctx.restore();

    // -- scanning cursor --
    if (upTo < total) {
      var scanX = upTo * pxPerSample;
      ctx.save();

      // Trailing glow
      var grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 2, 0);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, '#00d4ff18');
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 40, 0, 42, H);

      // Cursor line
      ctx.strokeStyle = '#00d4ffaa';
      ctx.lineWidth   = 1;
      ctx.shadowColor = '#00d4ff';
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.moveTo(scanX, 0);
      ctx.lineTo(scanX, H);
      ctx.stroke();

      ctx.restore();
    }

    drawTouchMarkers(W, H, midY, amp, upTo, total);
    drawTimeAxis(W, H, dur);
  }

  function drawGrid(W, H, dur) {
    ctx.save();
    ctx.strokeStyle = '#0d0d18';
    ctx.lineWidth   = 1;

    // Horizontal lines
    var hCount = 8;
    for (var row = 1; row < hCount; row++) {
      var y = (row / hCount) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Vertical lines (one per second)
    if (dur > 0) {
      var secW = W / dur;
      for (var s = 1; s < dur; s++) {
        var x = s * secW;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCenterLine(W, H) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#18182a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTimeAxis(W, H, dur) {
    ctx.save();
    ctx.fillStyle    = '#33334a';
    ctx.font         = '10px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    var secW  = W / Math.max(1, dur);
    var step  = 1;
    // Show fewer labels if too crowded (< 40 px per label)
    if (secW < 40) step = Math.ceil(40 / secW);

    for (var s = 0; s <= dur; s += step) {
      var x = s * secW;
      ctx.fillText(s + 's', x, H - 2);
    }
    ctx.restore();
  }

  function drawTouchMarkers(W, H, midY, amp, upTo, total) {
    if (!config.touches || config.touches.length === 0) return;

    ctx.save();
    config.touches.forEach(function (touch) {
      var sampleAtTouch = Math.floor(touch.time * SAMPLE_RATE);
      if (sampleAtTouch > upTo) return;

      var x = (touch.time / config.duration) * W;

      // Marker vertical line (dashed red)
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = '#ff4d4d55';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);

      // Time label above
      ctx.fillStyle    = '#ff7070';
      ctx.font         = 'bold 9px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(touch.time.toFixed(1) + 's', x, 4);

      // Intensity tick below the waveform centre
      var barH = touch.intensity * amp * 0.55;
      ctx.fillStyle = '#ff4d4d30';
      ctx.fillRect(x - 1, midY + 1, 2, barH);
    });
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

})();
