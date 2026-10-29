'use strict';

// ---------- tabs ----------
var tabs = document.querySelectorAll('.tab');
tabs.forEach(function (t) {
  t.addEventListener('click', function () {
    tabs.forEach(function (x) { x.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
  });
});

function $(id) { return document.getElementById(id); }
function show(el, on) { el.classList.toggle('hidden', !on); }

// ---------- health / config ----------
function setPill(el, on, okText, offText) {
  el.textContent = on ? okText : offText;
  el.classList.toggle('pill-on', on);
  el.classList.toggle('pill-off', !on);
}

function refreshHealth() {
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
    setPill($('status-engine'), h.asr_engine && h.asr_engine.reachable,
      'ASR engine: online', 'ASR engine: offline (run engine/run.sh)');
    setPill($('status-tts'), true, 'TTS: ready (Supertonic 3)', 'TTS: loading');
  }).catch(function () {
    setPill($('status-engine'), false, 'ASR engine: online', 'ASR engine: offline');
  });
}

fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
  var lang = $('tts-lang');
  cfg.languages.forEach(function (l) {
    var o = document.createElement('option');
    o.value = l.code; o.textContent = l.name + ' (' + l.code + ')';
    if (l.code === 'ro') { o.selected = true; }
    lang.appendChild(o);
  });
  var voice = $('tts-voice');
  cfg.voices.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = (v[0] === 'M' ? 'Male ' : 'Female ') + v;
    voice.appendChild(o);
  });
}).catch(function () {});
refreshHealth();
setInterval(refreshHealth, 15000);

// ---------- model hints (file + live tabs share the same models) ----------
var HINTS = {
  'parakeet-v3': '25 European languages including Romanian. Best default for Romanian audio.',
  'parakeet-v2-en': 'English only, higher accuracy.',
  'parakeet-unified-en': 'English with punctuation and capitalization.',
  'parakeet-ultra': 'Post-training refinement of Parakeet v3: same 25 languages (incl. Romanian) and same speed, clearly better accuracy (mean FLEURS WER 11.67% vs 14.81%). Best choice for Romanian audio.',
  'nemotron-unified-ro': 'nvidia/nemotron-labs-unified-asr-0.6b with the Romanian language prompt: a unified multilingual checkpoint worth comparing against Parakeet for Romanian.',
  'nemotron35-en': 'Nemotron 3.5 Transcribe Lite (Core ML) + Nemotron-3-Diarization: English meetings with speaker labels, hundreds of times real time.'
};
$('asr-model').addEventListener('change', function () { $('model-hint').textContent = HINTS[this.value] || ''; });
$('model-hint').textContent = HINTS['parakeet-v3'];
$('live-model').addEventListener('change', function () { $('live-model-hint').textContent = HINTS[this.value] || ''; });
$('live-model-hint').textContent = HINTS['parakeet-v3'];

// ---------- transcription ----------
var drop = $('dropzone');
drop.addEventListener('click', function () { $('asr-file').click(); });
['dragover', 'dragenter'].forEach(function (e) {
  drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('drag'); });
});
['dragleave', 'drop'].forEach(function (e) {
  drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('drag'); });
});
drop.addEventListener('drop', function (ev) {
  if (ev.dataTransfer.files.length) { $('asr-file').files = ev.dataTransfer.files; showFile(); }
});
$('asr-file').addEventListener('change', showFile);
function showFile() {
  var f = $('asr-file').files[0];
  $('file-name').textContent = f ? f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)' : '';
}

var lastTranscript = '';
$('form-transcribe').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var f = $('asr-file').files[0];
  var err = $('asr-error');
  show(err, false);
  if (!f) { err.textContent = 'Please choose an audio or video file first.'; show(err, true); return; }

  var fd = new FormData();
  fd.append('file', f);
  fd.append('model', $('asr-model').value);

  var btn = $('btn-transcribe');
  btn.disabled = true;
  btn.textContent = 'Transcribing...';
  show($('asr-result'), false);

  fetch('/api/transcribe', { method: 'POST', body: fd }).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, j: j }; });
  }).then(function (res) {
    if (!res.ok) { throw new Error(res.j.detail || 'Transcription failed'); }
    renderTranscript(res.j);
  }).catch(function (e) {
    err.textContent = String(e.message || e);
    show(err, true);
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'Transcribe';
  });
});

function fmtSec(s) {
  var m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function renderTranscript(j) {
  lastTranscript = j.transcript || '';
  $('asr-elapsed').textContent = j.elapsed_s ? 'in ' + j.elapsed_s + ' s' : '';
  var turns = $('asr-turns');
  turns.innerHTML = '';
  if (j.turns && j.turns.length) {
    j.turns.forEach(function (t) {
      var div = document.createElement('div');
      div.className = 'turn';
      var who = document.createElement('span'); who.className = 'who'; who.textContent = t.speaker;
      var time = document.createElement('span'); time.className = 'time'; time.textContent = '[' + fmtSec(t.start) + ']';
      var txt = document.createElement('span'); txt.textContent = t.text;
      div.appendChild(who); div.appendChild(time); div.appendChild(txt);
      turns.appendChild(div);
    });
    show($('asr-text'), false);
  } else {
    show($('asr-text'), true);
    $('asr-text').textContent = lastTranscript || '(empty transcript)';
  }
  $('asr-raw').textContent = j.raw_output || '';
  show($('asr-result'), true);
}

$('btn-copy').addEventListener('click', function () {
  navigator.clipboard.writeText(lastTranscript).then(function () {
    $('btn-copy').textContent = 'Copied';
    setTimeout(function () { $('btn-copy').textContent = 'Copy'; }, 1500);
  });
});
$('btn-download-txt').addEventListener('click', function () {
  var blob = new Blob([lastTranscript], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'transcript.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- live transcription (microphone -> chunks -> /api/transcribe) ----------
var LIVE_CHUNK_MS = 6000;   // send a chunk to the engine every 6 seconds
var LIVE_MIN_MS = 400;      // do not send a tail shorter than this

var live = {
  recording: false,
  ctx: null,
  stream: null,
  source: null,
  processor: null,
  chunks: [],
  chunkSamples: 0,
  chunkIndex: 0,
  results: {},        // chunkIndex -> transcript (kept until appended in order)
  nextToAppend: 0,
  sampleRate: 48000,
  startedAt: 0,
  flushTimer: null,
  clockTimer: null
};

function encodeWav(samples, sampleRate) {
  var buf = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buf);
  function wstr(off, s) { for (var i = 0; i < s.length; i++) { view.setUint8(off + i, s.charCodeAt(i)); } }
  wstr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wstr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  var off = 44;
  for (var i = 0; i < samples.length; i++, off += 2) {
    var s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

function liveAppend(text) {
  if (!text) { return; }
  var pre = $('live-text');
  pre.textContent = pre.textContent ? pre.textContent + ' ' + text : text;
}

function liveDeliver() {
  while (live.results[live.nextToAppend] !== undefined) {
    liveAppend(live.results[live.nextToAppend]);
    delete live.results[live.nextToAppend];
    live.nextToAppend++;
  }
}

function liveShowError(msg) {
  var err = $('live-error');
  err.textContent = String(msg);
  show(err, true);
}

function sendLiveChunk(index, samples, sampleRate) {
  var blob = encodeWav(samples, sampleRate);
  var fd = new FormData();
  fd.append('file', blob, 'live-' + index + '.wav');
  fd.append('model', $('live-model').value);
  fetch('/api/transcribe', { method: 'POST', body: fd })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (res.ok) {
        live.results[index] = (res.j.transcript || '').trim();
      } else {
        live.results[index] = '';
        liveShowError(res.j.detail || 'Chunk transcription failed');
      }
      liveDeliver();
    })
    .catch(function () {
      live.results[index] = '';
      liveDeliver();
    });
}

function flushLiveChunk() {
  if (live.chunkSamples === 0) { return; }
  var ms = live.chunkSamples / live.sampleRate * 1000;
  if (ms < LIVE_MIN_MS) { return; }
  var merged = new Float32Array(live.chunkSamples);
  var off = 0;
  live.chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
  live.chunks = [];
  live.chunkSamples = 0;
  sendLiveChunk(live.chunkIndex++, merged, live.sampleRate);
}

function startLive() {
  var err = $('live-error');
  show(err, false);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    err.textContent = 'Live recording is not supported in this browser.';
    show(err, true);
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    live.ctx = new Ctx();
    live.sampleRate = live.ctx.sampleRate;
    live.stream = stream;
    live.source = live.ctx.createMediaStreamSource(stream);
    live.processor = live.ctx.createScriptProcessor(4096, 1, 1);
    live.chunks = [];
    live.chunkSamples = 0;
    live.chunkIndex = 0;
    live.results = {};
    live.nextToAppend = 0;
    live.recording = true;
    live.startedAt = Date.now();
    live.processor.onaudioprocess = function (e) {
      if (!live.recording) { return; }
      var data = new Float32Array(e.inputBuffer.getChannelData(0));
      live.chunks.push(data);
      live.chunkSamples += data.length;
    };
    live.source.connect(live.processor);
    var sink = live.ctx.createGain();
    sink.gain.value = 0;
    live.processor.connect(sink);
    sink.connect(live.ctx.destination);
    live.flushTimer = setInterval(flushLiveChunk, LIVE_CHUNK_MS);
    live.clockTimer = setInterval(function () {
      $('live-status').textContent = 'Recording... ' + fmtSec((Date.now() - live.startedAt) / 1000);
    }, 1000);
    $('live-text').textContent = '';
    $('live-status').textContent = 'Recording... 0:00';
    $('btn-live').textContent = 'Stop recording';
    $('btn-live').classList.add('rec');
    show($('live-result'), true);
  }).catch(function (e) {
    err.textContent = 'Microphone access denied or unavailable: ' + (e.message || e);
    show(err, true);
  });
}

function stopLive() {
  live.recording = false;
  clearInterval(live.flushTimer);
  clearInterval(live.clockTimer);
  try { flushLiveChunk(); } catch (e) { /* ignore */ }
  try { live.processor.disconnect(); live.source.disconnect(); } catch (e) { /* ignore */ }
  try {
    live.stream.getTracks().forEach(function (t) { t.stop(); });
    live.ctx.close();
  } catch (e) { /* ignore */ }
  $('live-status').textContent = 'Stopped. Recorded ' + fmtSec((Date.now() - live.startedAt) / 1000) + '.';
  $('btn-live').textContent = 'Start recording';
  $('btn-live').classList.remove('rec');
}

$('btn-live').addEventListener('click', function () {
  if (live.recording) { stopLive(); } else { startLive(); }
});

$('live-copy').addEventListener('click', function () {
  navigator.clipboard.writeText($('live-text').textContent).then(function () {
    $('live-copy').textContent = 'Copied';
    setTimeout(function () { $('live-copy').textContent = 'Copy'; }, 1500);
  });
});
$('live-download-txt').addEventListener('click', function () {
  var blob = new Blob([$('live-text').textContent], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'live-transcript.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- text-to-speech ----------
$('tts-speed').addEventListener('input', function () { $('speed-val').textContent = this.value; });
$('tts-steps').addEventListener('input', function () { $('steps-val').textContent = this.value; });

$('form-tts').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var err = $('tts-error');
  show(err, false);

  var body = {
    text: $('tts-text').value,
    lang: $('tts-lang').value,
    voice: $('tts-voice').value,
    speed: parseFloat($('tts-speed').value),
    steps: parseInt($('tts-steps').value, 10)
  };

  var btn = $('btn-tts');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  show($('tts-result'), false);

  fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    if (!r.ok) {
      return r.json().then(function (j) { throw new Error(j.detail || 'TTS failed'); });
    }
    var dur = r.headers.get('X-Duration-Seconds');
    return r.blob().then(function (b) { return { blob: b, dur: dur }; });
  }).then(function (res) {
    var url = URL.createObjectURL(res.blob);
    $('tts-audio').src = url;
    $('tts-download').href = url;
    $('tts-duration').textContent = res.dur ? res.dur + ' s of audio' : '';
    show($('tts-result'), true);
    $('tts-audio').play().catch(function () {});
  }).catch(function (e) {
    err.textContent = String(e.message || e);
    show(err, true);
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'Generate speech';
  });
});
