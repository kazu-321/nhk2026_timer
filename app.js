(() => {
  const clock = document.querySelector('#clock');
  const setupButton = document.querySelector('#setup-btn');
  const teamIntroButton = document.querySelector('#team-intro-btn');
  const matchButton = document.querySelector('#match-btn');
  const settingsButton = document.querySelector('#settings-btn');
  const settingsDialog = document.querySelector('#settings-dialog');
  const closeSettingsButton = document.querySelector('#close-settings');
  const volumeControl = document.querySelector('#volume-control');
  const volumeValue = document.querySelector('#volume-value');
  const bgmToggle = document.querySelector('#bgm-toggle');
  const bgmValue = document.querySelector('#bgm-value');
  const bassBoostToggle = document.querySelector('#bass-boost-toggle');
  const bassBoostValue = document.querySelector('#bass-boost-value');
  const bassAmountSetting = document.querySelector('#bass-amount-setting');
  const bassAmountControl = document.querySelector('#bass-amount-control');
  const bassAmountValue = document.querySelector('#bass-amount-value');
  const matchStartTimeControl = document.querySelector('#match-start-time');

  let context;
  let masterGain;
  let volumePercent = 100;
  let bgmSource = null;
  let bgmBassFilter = null;
  let bgmGain = null;
  let bassBoostEnabled = false;
  let bassBoostPercent = 250;
  let matchStartSeconds = 0;
  let audioReady = Promise.resolve();
  let mode = 'ready';
  let config = { duration_seconds: 180, setup_whistle_file: 'whistle.m4a', setup_duration_seconds: 60, cues: [] };
  let decoded = new Map();
  let sources = [];
  let frame = 0;
  let baseTime = 0;
  let matchAnchor = 0;
  let matchClockAnchor = 0;
  const audioFileCache = new Map();

  const audioContext = () => {
    if (!context) {
      context = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = context.createGain();
      masterGain.gain.value = volumePercent / 100;
      masterGain.connect(context.destination);
    }
    return context;
  };
  const fmt = (seconds) => {
    const value = Math.floor(Math.abs(seconds));
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };
  const scheduleBuffer = (buffer, when, track = true) => {
    if (!buffer || !context) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    source.start(Math.max(context.currentTime + 0.015, when));
    if (track) sources.push(source);
    return source;
  };
  function setVolume(value) {
    volumePercent = Math.max(0, Math.min(500, Number(value)));
    volumeValue.value = `${volumePercent}%`;
    if (masterGain && context) masterGain.gain.setTargetAtTime(volumePercent / 100, context.currentTime, 0.015);
  }
  function setBassBoost(enabled) {
    bassBoostEnabled = Boolean(enabled);
    bassBoostValue.value = bassBoostEnabled ? 'ON' : 'OFF';
    bassAmountSetting.hidden = !bassBoostEnabled;
    updateBassFilter();
  }
  function setBassBoostAmount(value) {
    bassBoostPercent = Math.max(100, Math.min(500, Number(value)));
    bassAmountValue.value = `${bassBoostPercent}%`;
    updateBassFilter();
  }
  function updateBassFilter() {
    if (bgmBassFilter && context) {
      const gainDb = bassBoostEnabled ? 20 * Math.log10(bassBoostPercent / 100) : 0;
      bgmBassFilter.gain.setTargetAtTime(gainDb, context.currentTime, 0.02);
    }
  }
  function setBgmAudible(audible, fadeSeconds = 0) {
    if (!bgmGain || !context) return;
    const gain = bgmGain.gain;
    const now = context.currentTime;
    const target = audible ? 1 : 0;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (fadeSeconds > 0) gain.linearRampToValueAtTime(target, now + fadeSeconds);
    else gain.setValueAtTime(target, now);
  }
  const timerIsActive = () => mode === 'setup' || mode === 'match-countdown' || mode === 'match';
  async function setBgm(enabled) {
    const ac = audioContext();
    try { await ac.resume(); } catch (_) { /* audio remains unavailable */ }
    await audioReady;
    if (!enabled) {
      if (bgmSource) {
        try { bgmSource.stop(); } catch (_) { /* already stopped */ }
        bgmSource.disconnect();
        bgmSource = null;
      }
      if (bgmBassFilter) {
        bgmBassFilter.disconnect();
        bgmBassFilter = null;
      }
      if (bgmGain) {
        bgmGain.disconnect();
        bgmGain = null;
      }
      bgmValue.value = 'OFF';
      return;
    }
    const buffer = decoded.get('bgm.m4a');
    if (!buffer) {
      bgmToggle.checked = false;
      bgmValue.value = 'OFF';
      return;
    }
    if (!bgmSource) {
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const bass = ac.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 140;
      bass.gain.value = bassBoostEnabled ? 20 * Math.log10(bassBoostPercent / 100) : 0;
      const bgmVolume = ac.createGain();
      bgmVolume.gain.value = timerIsActive() ? 0 : 1;
      source.connect(bass);
      bass.connect(bgmVolume);
      bgmVolume.connect(masterGain);
      source.start(ac.currentTime + 0.02);
      bgmSource = source;
      bgmBassFilter = bass;
      bgmGain = bgmVolume;
    }
    bgmValue.value = 'ON';
  }
  async function playTeamIntro() {
    const ac = audioContext();
    try { await ac.resume(); } catch (_) { /* audio remains unavailable */ }
    await audioReady;
    scheduleBuffer(decoded.get('before_start.m4a'), ac.currentTime + 0.02, false);
  }
  function stopSources() {
    for (const source of sources) {
      try { source.stop(); } catch (_) { /* already ended */ }
    }
    sources = [];
  }
  function setReadout(text, kind = '') {
    clock.textContent = text;
    clock.className = `clock ${kind}`.trim();
  }
  function stopAll() {
    cancelAnimationFrame(frame);
    stopSources();
    mode = 'ready';
    setBgmAudible(true, 2);
    setupButton.textContent = 'セッティングタイム';
    matchButton.textContent = '試合';
    setReadout('0:00');
  }
  function displayMatchCountdown() {
    const now = audioContext().currentTime;
    const elapsed = now - baseTime;
    if (elapsed < 1) {
      setReadout('READY', 'ready-word');
    } else if (elapsed < 6) {
      const number = Math.max(1, 6 - Math.floor(elapsed));
      setReadout(String(number), 'countdown');
    } else if (elapsed < 8) {
      setReadout('START', 'start-word');
    } else {
      mode = 'match';
      matchButton.textContent = '試合終了';
      const shown = Math.min(config.duration_seconds, Math.floor(now - matchClockAnchor + matchStartSeconds));
      setReadout(fmt(shown));
      if (shown >= config.duration_seconds) {
        mode = 'done';
        matchButton.textContent = 'もう一度';
        setBgmAudible(true, 2);
        return;
      }
    }
    if (mode === 'match-countdown') frame = requestAnimationFrame(displayMatchCountdown);
    else if (mode === 'match') frame = requestAnimationFrame(displayMatchCountdown);
  }
  function scheduleMatchCues(startCueAnchor, clockAnchor, startSeconds) {
    for (const cue of config.cues) {
      const cueTime = Number(cue.play_at_elapsed_seconds);
      const when = cueTime < 0
        ? startCueAnchor + cueTime
        : clockAnchor + cueTime - startSeconds;
      if (when >= audioContext().currentTime) scheduleBuffer(decoded.get(cue.file), when);
    }
  }
  function readMatchStartSeconds() {
    const raw = matchStartTimeControl.value.trim();
    const parsed = raw === '' ? 0 : Number(raw);
    const maximum = Number(config.duration_seconds || 180);
    matchStartSeconds = Number.isFinite(parsed)
      ? Math.max(-60, Math.min(maximum, Math.round(parsed)))
      : 0;
    matchStartTimeControl.value = String(matchStartSeconds);
    return matchStartSeconds;
  }
  async function startMatch() {
    if (mode === 'match' || mode === 'match-countdown') {
      stopAll();
      return;
    }
    if (mode === 'done') {
      stopAll();
    }
    cancelAnimationFrame(frame);
    stopSources();
    const ac = audioContext();
    try { await ac.resume(); } catch (_) { /* audio remains unavailable */ }
    await audioReady;
    const startSeconds = readMatchStartSeconds();
    baseTime = ac.currentTime + 0.12;
    // START表示が始まった時刻を試合経過時間の起点にする。
    matchAnchor = baseTime + 6;
    matchClockAnchor = matchAnchor;
    mode = 'match-countdown';
    setBgmAudible(false);
    matchButton.textContent = '中止';
    scheduleMatchCues(matchAnchor, matchClockAnchor, startSeconds);
    frame = requestAnimationFrame(displayMatchCountdown);
  }
  function displaySetup() {
    if (mode !== 'setup') return;
    const elapsed = Math.max(0, audioContext().currentTime - baseTime);
    const setupDuration = Number(config.setup_duration_seconds || 60);
    if (elapsed >= setupDuration) {
      mode = 'setup-done';
      setupButton.textContent = 'セッティングタイム';
      setReadout(fmt(setupDuration));
      setBgmAudible(true, 2);
      return;
    }
    setReadout(fmt(elapsed));
    frame = requestAnimationFrame(displaySetup);
  }
  async function startSetup() {
    if (mode === 'setup') {
      stopAll();
      return;
    }
    cancelAnimationFrame(frame);
    stopSources();
    const ac = audioContext();
    try { await ac.resume(); } catch (_) { /* audio remains unavailable */ }
    await audioReady;
    mode = 'setup';
    setBgmAudible(false);
    baseTime = ac.currentTime + 0.12;
    setupButton.textContent = '終了';
    matchButton.textContent = '試合';
    setReadout('0:00');
    const whistle = decoded.get(config.setup_whistle_file);
    if (whistle) {
      scheduleBuffer(whistle, baseTime);
      scheduleBuffer(whistle, baseTime + Number(config.setup_duration_seconds || 60));
    }
    frame = requestAnimationFrame(displaySetup);
  }
  async function loadBuffer(file) {
    if (audioFileCache.has(file)) return audioFileCache.get(file);
    const promise = (async () => {
      const response = await fetch(`./sounds/${encodeURIComponent(file)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return audioContext().decodeAudioData(await response.arrayBuffer());
    })();
    audioFileCache.set(file, promise);
    try { return await promise; } catch (error) { audioFileCache.delete(file); throw error; }
  }
  async function loadAudio() {
    try {
      const response = await fetch('./cue-timings.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`cue-timings.json HTTP ${response.status}`);
      config = await response.json();
      const files = [...new Set([config.setup_whistle_file, 'bgm.m4a', 'before_start.m4a', ...(config.cues || []).map(item => item.file)])];
      const results = await Promise.allSettled(files.map(async file => [file, await loadBuffer(file)]));
      results.forEach(result => { if (result.status === 'fulfilled') decoded.set(...result.value); });
    } catch (error) {
      console.error('音声設定を読み込めません', error);
    }
  }

  setupButton.addEventListener('click', startSetup);
  matchButton.addEventListener('click', startMatch);
  teamIntroButton.addEventListener('click', playTeamIntro);
  settingsButton.addEventListener('click', () => settingsDialog.showModal());
  closeSettingsButton.addEventListener('click', () => settingsDialog.close());
  volumeControl.addEventListener('input', () => setVolume(volumeControl.value));
  bgmToggle.addEventListener('change', () => setBgm(bgmToggle.checked));
  bassBoostToggle.addEventListener('change', () => setBassBoost(bassBoostToggle.checked));
  bassAmountControl.addEventListener('input', () => setBassBoostAmount(bassAmountControl.value));
  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
  });
  setVolume(volumeControl.value);
  setBassBoost(bassBoostToggle.checked);
  setBassBoostAmount(bassAmountControl.value);
  audioReady = loadAudio();
})();
