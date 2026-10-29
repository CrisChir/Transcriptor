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

// ---------- model hint ----------
var HINTS = {
  'parakeet-v3': '25 European languages including Romanian. Best default for Romanian audio.',
  'parakeet-v2-en': 'English only, higher accuracy.',
  'parakeet-unified-en': 'English with punctuation and capitalization.',
  'nemotron35-en': 'Nemotron 3.5 Transcribe Lite (Core ML) + Nemotron-3-Diarization: English meetings with speaker labels, hundreds of times real time.'
};
$('asr-model').addEventListener('change', function () { $('model-hint').textContent = HINTS[this.value] || ''; });
$('model-hint').textContent = HINTS['parakeet-v3'];

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
