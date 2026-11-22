/* 《红楼梦》桌面阅读器 —— 渲染与交互 */
'use strict';

(() => {
  let D = window.HLM_DATA;
  const boot = document.getElementById('boot');
  const MOBILE_QUERY = window.matchMedia('(max-width: 1100px)');
  const isMobileLayout = () => MOBILE_QUERY.matches;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {
    toc: $('#toc'),
    tocList: $('#toc-list'),
    tocCount: $('#toc-count'),
    tocFilter: $('#toc-filter'),
    toggleToc: $('#toggle-toc'),
    reader: $('#reader'),
    kicker: $('#chapter-kicker'),
    heading: $('#chapter-heading'),
    body: $('#chapter-body'),
    prevCh: $('#prev-ch'),
    nextCh: $('#next-ch'),
    prevLabel: $('#prev-label'),
    nextLabel: $('#next-label'),
    notes: $('#notes'),
    notesBody: $('#notes-body'),
    notesTitle: $('#notes-title'),
    notesClose: $('#notes-close'),
    toggleNotes: $('#toggle-notes'),
    searchInput: $('#search-input'),
    searchClear: $('#search-clear'),
    searchPanel: $('#search-panel'),
    searchSummary: $('#search-summary'),
    searchResults: $('#search-results'),
    searchClose: $('#search-close'),
    zoomOut: $('#zoom-out'),
    zoomIn: $('#zoom-in'),
    zoomLabel: $('#zoom-label'),
    toast: $('#toast'),
    scrim: $('#drawer-scrim'),
    citeNav: $('#ai-cite-nav'),
    citeLabel: $('#ai-cite-label'),
    citeCount: $('#ai-cite-count'),
    citePrev: $('#ai-cite-prev'),
    citeNext: $('#ai-cite-next'),
    citeClose: $('#ai-cite-close'),
    readTask: $('#ai-read-task'),
    readRange: $('#ai-read-range'),
    readDuration: $('#ai-read-duration'),
    readFocus: $('#ai-read-focus'),
    readTimer: $('#ai-read-timer'),
    readProgress: $('#ai-read-progress'),
    readDone: $('#ai-read-done'),
    readClose: $('#ai-read-close'),
  };

  const PREF_KEY = 'hlm.reader.prefs.v1';
  const MIN_ZOOM = 0.75;
  const MAX_ZOOM = 2.0;
  const READ_BASE_PX = 20;
  const MAX_RESULTS = 200;
  const desktop = window.hlmDesktop || null;

  const state = {
    ci: 0,
    zoom: 1,
    tocOpen: true,
    notesOpen: true,
    noteId: null,
    tocItems: [],
    markerByNote: new Map(),
    missingMarkers: [],
    notesListScroll: 0,
    searchIndex: null,
    searchQuery: '',
    searchResults: [],
    searchTotal: 0,
    scrollTimer: 0,
    toastTimer: 0,
    restoreToastTimer: 0,
    zoomFrame: 0,
    pendingZoom: null,
    aiCitations: [],
    aiCiteIndex: -1,
    aiReading: null,
    readingTimer: 0,
    readingDeadline: 0,
    readingTotal: 0,
  };

  // ---------- 小工具 ----------
  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function clampZoom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.round(clamp(n, MIN_ZOOM, MAX_ZOOM) * 100) / 100;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconButton(className, text) {
    const b = el('button', className, text);
    b.type = 'button';
    return b;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function previewText(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > 96 ? s.slice(0, 96) + '…' : s;
  }

  function showToast(message, duration = 1100) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), duration);
  }

  function hideToast() {
    clearTimeout(state.toastTimer);
    els.toast.classList.remove('show');
  }

  function readPrefs() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  }

  function writePrefs(patch) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
    } catch {
      /* file:// 下若不可用则忽略，缩放和进度另有主进程存储 */
    }
  }

  function setScroll(top) {
    els.reader.style.scrollBehavior = 'auto';
    els.reader.scrollTop = top;
    requestAnimationFrame(() => { els.reader.style.scrollBehavior = ''; });
  }

  // ---------- 缩放 ----------
  function updateZoomLabel() {
    const percent = Math.round(state.zoom * 100);
    els.zoomLabel.textContent = `${percent}%`;
    els.zoomLabel.title = `当前缩放 ${percent}%，点击重置为 100%（Ctrl+0）`;
  }

  function applyReadingSize(value) {
    const z = clampZoom(value);
    const reader = els.reader;
    let anchor = null;
    let before = 0;
    if (reader && reader.clientHeight > 0) {
      const rect = reader.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      for (const dy of [24, 60, 96, 132]) {
        const node = document.elementFromPoint(x, rect.top + dy);
        anchor = node && node.closest ? node.closest('.para') : null;
        if (anchor) break;
      }
      if (anchor) before = anchor.getBoundingClientRect().top - rect.top;
    }
    document.documentElement.style.setProperty(
      '--read-size', `${(READ_BASE_PX * z).toFixed(2)}px`,
    );
    if (anchor) {
      const rect = reader.getBoundingClientRect();
      const after = anchor.getBoundingClientRect().top - rect.top;
      const previous = reader.style.scrollBehavior;
      reader.style.scrollBehavior = 'auto';
      reader.scrollTop += after - before;
      reader.style.scrollBehavior = previous;
    }
  }

  function setZoom(value, options = {}) {
    const z = clampZoom(value);
    state.zoom = z;
    applyReadingSize(z);
    updateZoomLabel();
    if (desktop && options.send !== false) desktop.setZoom(z);
    if (options.persist !== false) writePrefs({ zoom: z });
    if (!options.silent) showToast(`缩放 ${Math.round(z * 100)}%`);
    if (options.saveProgress !== false) setTimeout(() => saveProgressNow(), 180);
  }

  function zoomBy(delta) {
    const base = state.pendingZoom ?? state.zoom;
    state.pendingZoom = clampZoom(base + delta);
    if (state.zoomFrame) return;
    state.zoomFrame = requestAnimationFrame(() => {
      state.zoomFrame = 0;
      const next = state.pendingZoom;
      state.pendingZoom = null;
      if (next !== null) setZoom(next);
    });
  }

  // ---------- 面板与目录 ----------
  function updateScrim() {
    if (!els.scrim) return;
    const open = isMobileLayout() && (state.tocOpen || state.notesOpen);
    els.scrim.hidden = !open;
  }

  function applyPanelState() {
    if (isMobileLayout()) {
      // 手机上目录与注释都是覆盖层，不能像桌面那样把正文网格压窄。
      document.body.classList.remove('toc-hidden', 'notes-hidden');
      document.body.classList.toggle('toc-mobile-open', state.tocOpen);
      document.body.classList.toggle('notes-mobile-open', state.notesOpen);
    } else {
      document.body.classList.remove('toc-mobile-open', 'notes-mobile-open');
      document.body.classList.toggle('toc-hidden', !state.tocOpen);
      document.body.classList.toggle('notes-hidden', !state.notesOpen);
    }
    els.toggleToc.setAttribute('aria-pressed', String(state.tocOpen));
    els.toggleNotes.setAttribute('aria-pressed', String(state.notesOpen));
    updateScrim();
  }

  function setTocOpen(open) {
    state.tocOpen = Boolean(open);
    applyPanelState();
    writePrefs({ tocOpen: state.tocOpen });
    if (state.tocOpen) {
      requestAnimationFrame(() => {
        const active = state.tocItems[state.ci];
        if (active && !active.hidden) active.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  function setNotesOpen(open) {
    state.notesOpen = Boolean(open);
    applyPanelState();
    writePrefs({ notesOpen: state.notesOpen });
  }

  function ensureNotesOpen() {
    if (!state.notesOpen) setNotesOpen(true);
  }

  function buildToc() {
    const frag = document.createDocumentFragment();
    state.tocItems = [];
    D.chapters.forEach((chapter, ci) => {
      const item = el('button', 'toc-item');
      item.type = 'button';
      item.dataset.ci = String(ci);
      item.title = `${chapter.label} ${chapter.title}`;
      item.append(
        el('span', 'toc-label', chapter.label),
        el('span', 'toc-title', chapter.title),
      );
      item.addEventListener('click', () => goChapter(ci, { scroll: 'top' }));
      state.tocItems.push(item);
      frag.appendChild(item);
    });
    const empty = el('div', 'toc-empty', '没有匹配的回目');
    empty.hidden = true;
    state.tocEmpty = empty;
    frag.appendChild(empty);
    els.tocList.replaceChildren(frag);
    els.tocCount.textContent = `${D.chapters.length} 篇 · ${D.meta.hui} 回`;
  }

  function filterToc() {
    const q = els.tocFilter.value.trim().toLowerCase();
    let shown = 0;
    state.tocItems.forEach((item, ci) => {
      const chapter = D.chapters[ci];
      const hay = `${chapter.label} ${chapter.title} ${chapter.id}`.toLowerCase();
      const hit = !q || hay.includes(q);
      item.hidden = !hit;
      if (hit) shown += 1;
    });
    state.tocEmpty.hidden = shown > 0;
  }

  function updateTocActive() {
    state.tocItems.forEach((item, ci) => {
      const active = ci === state.ci;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    if (!state.tocOpen) return;
    const active = state.tocItems[state.ci];
    if (active && !active.hidden) active.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 正文渲染 ----------
  function markerTitle(token) {
    const kind = token.kind === 'collation' ? '校记' : '脚注';
    if (token.status !== 'ok') return `${kind} ${token.marker}（原书未收释义）`;
    return `${kind} ${token.marker}，点击查看`;
  }

  function fillContent(container, content, ci) {
    if (typeof content === 'string') {
      container.appendChild(document.createTextNode(content));
      return;
    }
    for (const part of content || []) {
      if (typeof part === 'string') {
        container.appendChild(document.createTextNode(part));
        continue;
      }
      const b = el('button', 'marker ' + (part.kind === 'collation' ? 'coll' : 'fn'));
      b.type = 'button';
      if (part.status !== 'ok') b.classList.add('missing');
      b.textContent = part.marker;
      b.title = markerTitle(part);
      b.setAttribute('aria-label', b.title);
      b.dataset.marker = part.marker;
      b.dataset.noteId = part.noteId || '';
      b.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateMarker(b, part, ci);
      });
      container.appendChild(b);
      if (part.noteId) {
        if (!state.markerByNote.has(part.noteId)) state.markerByNote.set(part.noteId, []);
        state.markerByNote.get(part.noteId).push(b);
      } else {
        state.missingMarkers.push({ token: part, el: b });
      }
    }
  }

  function updateChapterNav() {
    const prev = D.chapters[state.ci - 1];
    const next = D.chapters[state.ci + 1];
    els.prevCh.disabled = !prev;
    els.nextCh.disabled = !next;
    els.prevLabel.textContent = prev ? `${prev.label} ${prev.title}` : '已是全书开头';
    els.nextLabel.textContent = next ? `${next.label} ${next.title}` : '已是全书结尾';
    els.prevCh.title = prev ? `${prev.label} ${prev.title}` : '已是全书开头';
    els.nextCh.title = next ? `${next.label} ${next.title}` : '已是全书结尾';
  }

  function restoreScroll(progress) {
    const max = Math.max(0, els.reader.scrollHeight - els.reader.clientHeight);
    const ratio = Number(progress.ratio);
    let top = Number(progress.scrollTop) || 0;
    if (Number.isFinite(ratio) && ratio > 0) top = ratio * max;
    setScroll(clamp(top, 0, max));
  }

  function renderChapter(ci, options = {}) {
    const chapter = D.chapters[ci];
    if (!chapter) return;
    state.ci = ci;
    state.noteId = null;
    state.markerByNote = new Map();
    state.missingMarkers = [];

    els.kicker.textContent = `${chapter.label} · 全 ${D.meta.hui} 回`;
    els.heading.replaceChildren();
    fillContent(els.heading, chapter.heading, ci);

    const frag = document.createDocumentFragment();
    chapter.paragraphs.forEach((paragraph, pi) => {
      const p = el('p', 'para' + (paragraph.verse ? ' verse' : ''));
      p.id = `p-${ci}-${pi}`;
      fillContent(p, paragraph.tokens !== undefined ? paragraph.tokens : paragraph.text, ci);
      frag.appendChild(p);
    });
    els.body.replaceChildren(frag);
    applyAiCitationMarks();

    updateTocActive();
    updateChapterNav();
    renderNotesList();
    document.title = `${chapter.label} ${chapter.title} · 红楼梦`;
    window.dispatchEvent(new CustomEvent('hlm:chapterchange', {
      detail: {
        index: ci,
        hui: Number.parseInt(chapter.id, 10),
        label: chapter.label,
        title: chapter.title,
      },
    }));

    if (options.paragraph !== undefined && options.paragraph !== null) {
      requestAnimationFrame(() => {
        const target = document.getElementById(`p-${ci}-${options.paragraph}`);
        if (!target) return;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (options.query) highlightInElement(target, options.query);
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 2600);
      });
    } else if (options.progress) {
      requestAnimationFrame(() => requestAnimationFrame(() => restoreScroll(options.progress)));
    } else {
      setScroll(0);
    }

    if (options.restoring) {
      setTimeout(() => saveProgressNow(), 900);
    } else {
      requestAnimationFrame(() => saveProgressNow());
    }
  }

  function goChapter(ci, options = {}) {
    if (ci < 0 || ci >= D.chapters.length) return;
    if (isMobileLayout()) {
      if (state.tocOpen) setTocOpen(false);
      if (state.notesOpen && !options.keepNotes) setNotesOpen(false);
    }
    if (state.restoreToastTimer) {
      clearTimeout(state.restoreToastTimer);
      state.restoreToastTimer = 0;
    }
    if (els.toast.textContent.startsWith('已续读至')) hideToast();
    saveProgressNow();
    renderChapter(ci, options);
  }

  function huiToIndex(hui) {
    const n = Number(hui);
    if (!Number.isInteger(n) || n < 1 || n > 120) return -1;
    if (n <= 16) return n - 1;
    if (n <= 18) return 16;
    return n - 2;
  }

  // ---------- AI 引用：正文跟随、标红与导航 ----------
  function normalizeAiCitations(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;
      const hui = Number(raw.hui !== undefined ? raw.hui : raw.chapter);
      const rawStart = raw.start !== undefined
        ? raw.start
        : (raw.para !== undefined ? raw.para : raw.paragraph);
      let start = Number(rawStart);
      let end = raw.end !== undefined ? Number(raw.end) : start;
      if (end < start) [start, end] = [end, start];
      const index = huiToIndex(hui);
      const chapter = D.chapters[index];
      if (!chapter || !Number.isInteger(start) || !Number.isInteger(end) ||
          start < 1 || end > chapter.paragraphs.length) {
        continue;
      }
      const key = `${index}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hui, start, end, index, startPi: start - 1, endPi: end - 1 });
    }
    return out;
  }

  function applyAiCitationMarks() {
    if (!els.body) return;
    $$('.para.ai-cited, .para.ai-cited-active, .para.ai-reading, .para.ai-reading-start, .para.ai-reading-end', els.body)
      .forEach((node) => {
        node.classList.remove(
          'ai-cited', 'ai-cited-active',
          'ai-reading', 'ai-reading-start', 'ai-reading-end',
        );
      });
    state.aiCitations.forEach((citation, i) => {
      if (citation.index !== state.ci) return;
      for (let pi = citation.startPi; pi <= citation.endPi; pi += 1) {
        const target = document.getElementById(`p-${state.ci}-${pi}`);
        if (!target) continue;
        target.classList.add('ai-cited');
        if (i === state.aiCiteIndex) target.classList.add('ai-cited-active');
      }
    });
    const reading = state.aiReading;
    if (reading && reading.index === state.ci) {
      for (let pi = reading.startPi; pi <= reading.endPi; pi += 1) {
        const target = document.getElementById(`p-${state.ci}-${pi}`);
        if (!target) continue;
        target.classList.add('ai-reading');
        if (pi === reading.startPi) target.classList.add('ai-reading-start');
        if (pi === reading.endPi) target.classList.add('ai-reading-end');
      }
    }
  }

  function renderAiCiteNav() {
    if (!els.citeNav) return;
    if (state.aiReading) {
      els.citeNav.hidden = true;
      return;
    }
    const total = state.aiCitations.length;
    if (!total) {
      els.citeNav.hidden = true;
      return;
    }
    const index = state.aiCiteIndex >= 0 ? state.aiCiteIndex : 0;
    const citation = state.aiCitations[index];
    els.citeNav.hidden = false;
    if (els.citeLabel) {
      const range = citation.start === citation.end
        ? `p${citation.start}`
        : `p${citation.start}–p${citation.end}`;
      els.citeLabel.textContent = `第${citation.hui}回 · ${range}`;
    }
    if (els.citeCount) {
      els.citeCount.textContent = total > 1 ? `${index + 1} / ${total}` : '';
      els.citeCount.hidden = total < 2;
    }
    if (els.citePrev) {
      els.citePrev.hidden = total < 2;
      els.citePrev.disabled = index <= 0;
    }
    if (els.citeNext) {
      els.citeNext.hidden = total < 2;
      els.citeNext.disabled = index >= total - 1;
    }
  }

  function scrollToActiveCitation() {
    const citation = state.aiCitations[state.aiCiteIndex];
    if (!citation) return;
    const target = document.getElementById(`p-${state.ci}-${citation.startPi}`);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function focusAiCitation(index) {
    const total = state.aiCitations.length;
    if (!total) return false;
    const i = Math.max(0, Math.min(total - 1, Number(index) || 0));
    const citation = state.aiCitations[i];
    state.aiCiteIndex = i;
    if (state.ci !== citation.index) {
      goChapter(citation.index, { paragraph: citation.startPi });
      renderAiCiteNav();
    } else {
      applyAiCitationMarks();
      renderAiCiteNav();
      requestAnimationFrame(scrollToActiveCitation);
    }
    return true;
  }

  function setAiCitations(list) {
    const citations = normalizeAiCitations(list);
    if (!citations.length) {
      clearAiCitations();
      return false;
    }
    state.aiCitations = citations;
    state.aiCiteIndex = -1;
    focusAiCitation(0);
    return true;
  }

  function clearAiCitations() {
    state.aiCitations = [];
    state.aiCiteIndex = -1;
    applyAiCitationMarks();
    renderAiCiteNav();
  }

  function followAiChapter(hui) {
    const index = huiToIndex(hui);
    const chapter = D.chapters[index];
    if (!chapter) return false;
    if (state.ci !== index) {
      goChapter(index);
      showToast(`跟随 AI · ${chapter.label}`, 1200);
    }
    return true;
  }

  // ---------- AI 分段带读：范围标红、阅读计时、读完继续 ----------
  function readingTimeText(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 90) return `${Math.max(10, Math.ceil(total / 10) * 10)} 秒`;
    return `${Math.max(1, Math.round(total / 60))} 分钟`;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function stopReadingTimer() {
    if (!state.readingTimer) return;
    clearInterval(state.readingTimer);
    state.readingTimer = 0;
  }

  function updateReadingTimer() {
    const task = state.aiReading;
    if (!task || task.finished) return;
    const remain = Math.max(0, (state.readingDeadline - Date.now()) / 1000);
    const total = Math.max(1, state.readingTotal);
    if (els.readTimer) {
      els.readTimer.textContent = remain > 0 ? `剩余 ${formatClock(remain)}` : '时间到';
    }
    if (els.readProgress) {
      const percent = Math.min(100, Math.max(0, (1 - remain / total) * 100));
      els.readProgress.style.width = `${percent}%`;
    }
    if (remain <= 0) {
      stopReadingTimer();
      els.readTask?.classList.add('time-up');
      els.readDone?.classList.add('ready');
    }
  }

  function startReadingTimer(task) {
    stopReadingTimer();
    if (!task || task.finished) return;
    state.readingTotal = Math.max(1, Number(task.seconds) || 20);
    state.readingDeadline = Date.now() + state.readingTotal * 1000;
    els.readTask?.classList.remove('time-up', 'done');
    els.readDone?.classList.remove('ready');
    updateReadingTimer();
    state.readingTimer = setInterval(updateReadingTimer, 500);
  }

  function normalizeAiReading(task) {
    if (!task || typeof task !== 'object') return null;
    const hui = Number(task.hui !== undefined ? task.hui : task.chapter);
    const start = Number(task.start);
    const end = Number(task.end);
    const index = huiToIndex(hui);
    const chapter = D.chapters[index];
    if (!chapter || !Number.isInteger(start) || !Number.isInteger(end) ||
        start < 1 || end < start || end > chapter.paragraphs.length) {
      return null;
    }
    const chars = Math.max(0, Number(task.chars) || 0);
    const rawSeconds = Number(task.seconds);
    return {
      hui,
      start,
      end,
      index,
      startPi: start - 1,
      endPi: end - 1,
      chars,
      seconds: Number.isFinite(rawSeconds) && rawSeconds > 0
        ? Math.round(rawSeconds)
        : Math.max(20, Math.ceil(chars / 5)),
      focus: String(task.focus || '').trim(),
      chapterLabel: String(task.chapterLabel || '').trim(),
      finished: false,
    };
  }

  function renderAiReadingTask() {
    if (!els.readTask) return;
    const task = state.aiReading;
    if (!task) {
      els.readTask.hidden = true;
      return;
    }
    const range = task.start === task.end ? `p${task.start}` : `p${task.start}–p${task.end}`;
    els.readTask.hidden = false;
    els.readTask.classList.toggle('done', Boolean(task.finished));
    if (els.readRange) {
      els.readRange.textContent = `${task.chapterLabel || `第${task.hui}回`} · ${range}`;
    }
    if (els.readDuration) {
      els.readDuration.textContent = `建议约 ${readingTimeText(task.seconds)}`;
    }
    if (els.readFocus) {
      els.readFocus.textContent = task.focus;
      els.readFocus.hidden = !task.focus;
    }
    if (els.readDone) {
      els.readDone.disabled = Boolean(task.finished);
      els.readDone.textContent = task.finished ? '已读完，AI 正在讲解…' : '读完了，继续';
      if (task.finished) els.readDone.classList.remove('ready');
    }
    if (task.finished) {
      if (els.readTimer) els.readTimer.textContent = '已读完';
      if (els.readProgress) els.readProgress.style.width = '100%';
    }
  }

  function scrollToReadingStart() {
    const task = state.aiReading;
    if (!task) return;
    const target = document.getElementById(`p-${state.ci}-${task.startPi}`);
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function setAiReadingTask(task) {
    const normalized = normalizeAiReading(task);
    if (!normalized) {
      clearAiReadingTask();
      return false;
    }
    stopReadingTimer();
    state.aiReading = normalized;
    if (state.ci !== normalized.index) {
      goChapter(normalized.index);
    } else {
      applyAiCitationMarks();
    }
    renderAiReadingTask();
    renderAiCiteNav();
    startReadingTimer(normalized);
    requestAnimationFrame(scrollToReadingStart);
    return true;
  }

  function clearAiReadingTask() {
    stopReadingTimer();
    state.aiReading = null;
    state.readingDeadline = 0;
    state.readingTotal = 0;
    applyAiCitationMarks();
    renderAiReadingTask();
    renderAiCiteNav();
  }

  function finishAiReading() {
    const task = state.aiReading;
    if (!task || task.finished) return;
    task.finished = true;
    stopReadingTimer();
    renderAiReadingTask();
    let accepted = false;
    try {
      accepted = Boolean(window.HLM_AI && window.HLM_AI.continueReading
        && window.HLM_AI.continueReading(task));
    } catch {
      accepted = false;
    }
    if (!accepted) {
      task.finished = false;
      renderAiReadingTask();
      startReadingTimer(task);
      showToast('AI 暂时无法继续，请稍后再试。', 1600);
    }
  }

  function endAiReadingSession() {
    if (!state.aiReading || !state.aiReading.finished) return;
    clearAiReadingTask();
  }

  // ---------- 阅读进度 ----------
  function saveProgressNow(sync = false) {
    if (!D || !Array.isArray(D.chapters) || !D.chapters[state.ci]) return;
    const max = Math.max(0, els.reader.scrollHeight - els.reader.clientHeight);
    const progress = {
      chapter: state.ci,
      scrollTop: Math.round(els.reader.scrollTop),
      ratio: max > 0 ? clamp(els.reader.scrollTop / max, 0, 1) : 0,
    };
    if (desktop) {
      if (sync && typeof desktop.saveProgressSync === 'function') {
        desktop.saveProgressSync(progress);
      } else {
        desktop.saveProgress(progress);
      }
    } else {
      writePrefs({ progress });
    }
  }

  // ---------- 注释 ----------
  function clearActiveMarkers() {
    $$('.marker.active').forEach((marker) => marker.classList.remove('active'));
  }

  function kindLabel(kind) {
    if (kind === 'collation') return '校记';
    if (kind === 'mixed') return '脚注 + 校记';
    return '脚注';
  }

  function aliasChip(alias, extra = '') {
    const isColl = String(alias).startsWith('〔');
    const chip = el('span', 'alias-chip' + (isColl ? ' coll' : '') + (extra ? ' ' + extra : ''), alias);
    return chip;
  }

  function backToList() {
    state.noteId = null;
    clearActiveMarkers();
    renderNotesList({ preserveScroll: true });
  }

  function renderNotesList(options = {}) {
    const chapter = D.chapters[state.ci];
    if (!chapter) return;
    state.noteId = null;
    els.notesTitle.textContent = '注释';

    const frag = document.createDocumentFragment();
    let headText = `${chapter.label} · 本章注释 ${chapter.noteCount} 条`;
    if (state.missingMarkers.length) headText += ` · 缺定义 ${state.missingMarkers.length} 处`;
    frag.appendChild(el('div', 'notes-list-head', headText));

    if (state.missingMarkers.length) {
      const box = el('div', 'note-missing-box');
      box.appendChild(el('div', 'note-missing-title',
        `原书缺定义 ${state.missingMarkers.length} 处 · 点击角标查看同位置校记`));
      const chips = el('div', 'missing-chips');
      for (const item of state.missingMarkers) {
        const chip = el('button', 'missing-chip', item.token.marker);
        chip.type = 'button';
        chip.title = '原书未收此条释义';
        chip.addEventListener('click', () => {
          item.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          activateMarker(item.el, item.token, state.ci);
        });
        chips.appendChild(chip);
      }
      box.appendChild(chips);
      frag.appendChild(box);
    }

    chapter.noteOrder.forEach((noteId) => {
      const note = chapter.notes[noteId];
      if (!note) return;
      const item = el('button', 'note-list-item');
      item.type = 'button';
      item.dataset.noteId = noteId;
      const top = el('div', 'note-list-top');
      top.appendChild(el('span', 'kind-dot' + (note.kind === 'collation' ? ' coll' : '')));
      note.aliases.forEach((alias) => top.appendChild(aliasChip(alias)));
      item.append(top, el('div', 'note-preview', previewText(note.text)));
      item.addEventListener('click', () => openNote(noteId, { scrollMarker: true }));
      frag.appendChild(item);
    });

    if (!chapter.noteOrder.length && !state.missingMarkers.length) {
      frag.appendChild(el('div', 'notes-empty', '本章没有注释。'));
    }

    els.notesBody.replaceChildren(frag);
    els.notesBody.scrollTop = options.preserveScroll ? state.notesListScroll : 0;
    if (!options.preserveScroll) state.notesListScroll = 0;
  }

  function activateMarker(markerEl, token, ci) {
    state.ci = ci;
    clearActiveMarkers();
    markerEl.classList.add('active');
    const wasHidden = !state.notesOpen;
    ensureNotesOpen();
    if (wasHidden) {
      requestAnimationFrame(() => markerEl.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
    if (token.noteId) openNote(token.noteId, { el: markerEl });
    else openMissingNote(token, markerEl);
  }

  function openNote(noteId, options = {}) {
    const chapter = D.chapters[state.ci];
    const note = chapter && chapter.notes[noteId];
    if (!note) {
      openMissingNote({ marker: noteId, kind: 'footnote', status: 'missing_definition', adjacent: [] });
      return;
    }
    state.noteId = noteId;
    if (els.notesBody.querySelector('.notes-list-head')) {
      state.notesListScroll = els.notesBody.scrollTop;
    }
    renderNoteDetail(note, options);
  }

  function renderNoteDetail(note, options = {}) {
    const chapter = D.chapters[state.ci];
    els.notesTitle.textContent = '注释';
    clearActiveMarkers();
    const markers = state.markerByNote.get(note.id) || [];
    if (options.el) options.el.classList.add('active');
    else markers.forEach((marker) => marker.classList.add('active'));
    if (options.scrollMarker && markers[0]) {
      requestAnimationFrame(() => markers[0].scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }

    const wrap = el('div', 'note-detail');
    const meta = el('div', 'note-meta-row');
    meta.appendChild(el('span', 'kind-tag' + (note.kind === 'collation' ? ' coll' : ''), kindLabel(note.kind)));
    note.aliases.forEach((alias) => meta.appendChild(aliasChip(alias)));
    wrap.appendChild(meta);

    wrap.appendChild(el('div', 'note-text', note.text || '（此条无释文）'));

    const location = note.endLine && note.endLine !== note.line
      ? `底本第 ${note.sourceLine} 行 · 本章第 ${note.line}–${note.endLine} 行`
      : `底本第 ${note.sourceLine} 行 · 本章第 ${note.line} 行`;
    wrap.appendChild(el('div', 'note-source', location));

    const actions = el('div', 'note-actions');
    const back = el('button', 'link-btn', '← 本章注释');
    back.type = 'button';
    back.addEventListener('click', backToList);
    actions.appendChild(back);

    const index = chapter.noteOrder.indexOf(note.id);
    const nav = el('div', 'note-nav-btns');
    const prev = el('button', 'link-btn', '上一条');
    prev.type = 'button';
    prev.disabled = index <= 0;
    prev.addEventListener('click', () => {
      if (index > 0) openNote(chapter.noteOrder[index - 1], { scrollMarker: true });
    });
    const next = el('button', 'link-btn', '下一条');
    next.type = 'button';
    next.disabled = index < 0 || index >= chapter.noteOrder.length - 1;
    next.addEventListener('click', () => {
      if (index >= 0 && index < chapter.noteOrder.length - 1) {
        openNote(chapter.noteOrder[index + 1], { scrollMarker: true });
      }
    });
    nav.append(prev, next);
    actions.appendChild(nav);
    wrap.appendChild(actions);

    els.notesBody.replaceChildren(wrap);
    els.notesBody.scrollTop = 0;
  }

  function openMissingNote(token, markerEl) {
    const chapter = D.chapters[state.ci];
    if (els.notesBody.querySelector('.notes-list-head')) {
      state.notesListScroll = els.notesBody.scrollTop;
    }
    state.noteId = null;
    els.notesTitle.textContent = '注释';
    clearActiveMarkers();
    if (markerEl) markerEl.classList.add('active');

    const wrap = el('div', 'note-detail');
    const meta = el('div', 'note-meta-row');
    meta.appendChild(el('span', 'kind-tag missing',
      (token.kind === 'collation' ? '校记' : '脚注') + ' · 缺定义'));
    meta.appendChild(aliasChip(token.marker, 'missing'));
    wrap.appendChild(meta);

    wrap.appendChild(el('div', 'note-text',
      `原书正文此处有角标 ${token.marker}，但本章注释区未收对应的释义。`));

    const adjacent = Array.isArray(token.adjacent) ? token.adjacent : [];
    if (adjacent.length) {
      const box = el('div', 'note-missing-box');
      box.appendChild(el('div', 'note-missing-title',
        '同一位置紧邻的校记，供参考（并非本条注释）'));
      adjacent.forEach((noteId) => {
        const note = chapter.notes[noteId];
        if (!note) return;
        const item = el('div', 'adj-note');
        const alias = el('div', 'adj-alias');
        note.aliases.forEach((a) => alias.appendChild(aliasChip(a)));
        alias.appendChild(document.createTextNode(' 校记'));
        item.append(alias, el('div', 'adj-text', note.text));
        box.appendChild(item);
      });
      wrap.appendChild(box);
    }

    const actions = el('div', 'note-actions');
    const back = el('button', 'link-btn', '← 本章注释');
    back.type = 'button';
    back.addEventListener('click', backToList);
    actions.appendChild(back);
    wrap.appendChild(actions);

    els.notesBody.replaceChildren(wrap);
    els.notesBody.scrollTop = 0;
  }

  // ---------- 搜索 ----------
  function ensureSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    const started = performance.now();
    const index = [];
    for (let ci = 0; ci < D.chapters.length; ci += 1) {
      const chapter = D.chapters[ci];
      for (let pi = 0; pi < chapter.paragraphs.length; pi += 1) {
        const paragraph = chapter.paragraphs[pi];
        const text = paragraph.text !== undefined
          ? paragraph.text
          : paragraph.tokens.filter((token) => typeof token === 'string').join('');
        if (!text.trim()) continue;
        index.push({ ci, pi, text, lower: text.toLowerCase() });
      }
    }
    state.searchIndex = index;
    console.debug(`search index: ${index.length} paragraphs, ${Math.round(performance.now() - started)}ms`);
    return index;
  }

  function buildSearchIndexAsync() {
    if (state.searchIndex) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 180));
    idle(() => ensureSearchIndex(), { timeout: 4000 });
  }

  function highlightHtml(piece, query) {
    const lower = piece.toLowerCase();
    const q = query.toLowerCase();
    if (!q) return escapeHtml(piece);
    let out = '';
    let pos = 0;
    while (pos <= piece.length) {
      const hit = lower.indexOf(q, pos);
      if (hit < 0) {
        out += escapeHtml(piece.slice(pos));
        break;
      }
      out += escapeHtml(piece.slice(pos, hit));
      out += '<mark>' + escapeHtml(piece.slice(hit, hit + query.length)) + '</mark>';
      pos = hit + query.length;
    }
    return out;
  }

  function snippetHtml(text, query) {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const hit = lower.indexOf(q);
    const start = Math.max(0, (hit < 0 ? 0 : hit) - 36);
    const end = Math.min(text.length, (hit < 0 ? 0 : hit) + query.length + 56);
    const piece = text.slice(start, end);
    return (start > 0 ? '…' : '') + highlightHtml(piece, query) + (end < text.length ? '…' : '');
  }

  function runSearch(raw) {
    const query = String(raw || '').trim();
    state.searchQuery = query;
    if (!query) {
      closeSearch(true);
      return;
    }
    const index = ensureSearchIndex();
    const q = query.toLowerCase();
    const results = [];
    let total = 0;
    for (const item of index) {
      if (item.lower.indexOf(q) >= 0) {
        total += 1;
        if (results.length < MAX_RESULTS) results.push(item);
      }
    }
    state.searchResults = results;
    state.searchTotal = total;
    renderSearchResults(query, results, total);
    els.searchPanel.hidden = false;
  }

  function renderSearchResults(query, results, total) {
    const summary = total
      ? `在 ${total.toLocaleString('zh-CN')} 个段落中找到“${query}”` +
        (total > MAX_RESULTS ? ` · 仅显示前 ${MAX_RESULTS} 段` : '')
      : `没有找到“${query}”`;
    els.searchSummary.textContent = summary;

    const frag = document.createDocumentFragment();
    if (!results.length) {
      frag.appendChild(el('div', 'search-empty', '试试更短的关键词，或换一个写法。'));
      els.searchResults.replaceChildren(frag);
      return;
    }

    results.forEach((result) => {
      const item = el('button', 'search-item');
      item.type = 'button';
      const chapter = D.chapters[result.ci];
      item.appendChild(el('span', 'search-item-ch', chapter.label));
      const snippet = el('span', 'search-snippet');
      snippet.innerHTML = snippetHtml(result.text, query);
      item.appendChild(snippet);
      item.addEventListener('click', () => {
        closeSearch(false);
        goChapter(result.ci, { paragraph: result.pi, query });
      });
      frag.appendChild(item);
    });
    els.searchResults.replaceChildren(frag);
    els.searchResults.scrollTop = 0;
  }

  function closeSearch(clear) {
    els.searchPanel.hidden = true;
    if (clear) {
      els.searchInput.value = '';
      els.searchClear.hidden = true;
      state.searchQuery = '';
      clearSearchHighlights();
    }
  }

  function clearSearchHighlights() {
    $$('mark.search-hit').forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
  }

  function highlightInElement(root, query) {
    const q = query.toLowerCase();
    if (!q) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue) continue;
      if (node.parentElement && node.parentElement.closest('.marker')) continue;
      if (node.nodeValue.toLowerCase().includes(q)) nodes.push(node);
    }
    for (const node of nodes) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let pos = 0;
      let hit = lower.indexOf(q, pos);
      while (hit >= 0) {
        if (hit > pos) frag.appendChild(document.createTextNode(text.slice(pos, hit)));
        const mark = el('mark', 'search-hit', text.slice(hit, hit + query.length));
        frag.appendChild(mark);
        pos = hit + query.length;
        hit = lower.indexOf(q, pos);
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  function focusSearch() {
    els.searchInput.focus();
    els.searchInput.select();
    const query = els.searchInput.value.trim();
    if (query) runSearch(query);
  }

  // ---------- 事件 ----------
  els.toggleToc.addEventListener('click', () => setTocOpen(!state.tocOpen));
  els.toggleNotes.addEventListener('click', () => setNotesOpen(!state.notesOpen));
  els.notesClose.addEventListener('click', () => setNotesOpen(false));
  if (els.scrim) {
    els.scrim.addEventListener('click', () => {
      setTocOpen(false);
      setNotesOpen(false);
    });
  }

  let lastMobileLayout = isMobileLayout();
  window.addEventListener('resize', () => {
    const now = isMobileLayout();
    if (now === lastMobileLayout) return;
    lastMobileLayout = now;
    if (now) {
      state.tocOpen = false;
      state.notesOpen = false;
    }
    applyPanelState();
  }, { passive: true });
  els.prevCh.addEventListener('click', () => goChapter(state.ci - 1, { scroll: 'top' }));
  els.nextCh.addEventListener('click', () => goChapter(state.ci + 1, { scroll: 'top' }));
  els.tocFilter.addEventListener('input', filterToc);

  els.zoomOut.addEventListener('click', () => zoomBy(-0.1));
  els.zoomIn.addEventListener('click', () => zoomBy(0.1));
  els.zoomLabel.addEventListener('click', () => setZoom(1));

  if (els.citePrev) {
    els.citePrev.addEventListener('click', () => focusAiCitation(state.aiCiteIndex - 1));
  }
  if (els.citeNext) {
    els.citeNext.addEventListener('click', () => focusAiCitation(state.aiCiteIndex + 1));
  }
  if (els.citeClose) {
    els.citeClose.addEventListener('click', clearAiCitations);
  }
  if (els.readDone) {
    els.readDone.addEventListener('click', finishAiReading);
  }
  if (els.readClose) {
    els.readClose.addEventListener('click', clearAiReadingTask);
  }

  let searchTimer = 0;
  els.searchInput.addEventListener('input', () => {
    const raw = els.searchInput.value;
    els.searchClear.hidden = raw.length === 0;
    clearTimeout(searchTimer);
    if (!raw.trim()) {
      closeSearch(true);
      return;
    }
    searchTimer = setTimeout(() => runSearch(raw), 140);
  });
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = els.searchResults.querySelector('.search-item');
      if (first) first.click();
    } else if (event.key === 'ArrowDown') {
      const first = els.searchResults.querySelector('.search-item');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch(false);
      els.searchInput.blur();
    }
  });
  els.searchClear.addEventListener('click', () => {
    closeSearch(true);
    els.searchInput.focus();
  });
  els.searchClose.addEventListener('click', () => {
    closeSearch(false);
    els.searchInput.focus();
  });

  els.searchPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearch(false);
      els.searchInput.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = $$('.search-item', els.searchResults);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : Math.min(items.length - 1, current + 1);
    } else {
      next = current < 0 ? items.length - 1 : Math.max(0, current - 1);
    }
    items[next].focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (els.searchPanel.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (els.searchPanel.contains(target) || target.closest('.search-wrap')) return;
    closeSearch(false);
  }, true);

  window.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (event.deltaY === 0) return;
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || (target && target.isContentEditable);

    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (key === 'b') {
        event.preventDefault();
        setTocOpen(!state.tocOpen);
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        setNotesOpen(!state.notesOpen);
        return;
      }
      if (key === '+' || key === '=') {
        event.preventDefault();
        zoomBy(0.1);
        return;
      }
      if (key === '-' || key === '_') {
        event.preventDefault();
        zoomBy(-0.1);
        return;
      }
      if (key === '0') {
        event.preventDefault();
        setZoom(1);
        return;
      }
    }

    if (typing) return;

    if (event.key === 'Escape') {
      if (!els.searchPanel.hidden) {
        closeSearch(false);
        return;
      }
      if (els.notesBody.querySelector('.note-detail')) {
        backToList();
      }
      return;
    }

    if (!els.searchPanel.hidden) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goChapter(state.ci - 1, { scroll: 'top' });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goChapter(state.ci + 1, { scroll: 'top' });
    }
  });

  els.reader.addEventListener('scroll', () => {
    if (state.scrollTimer) return;
    state.scrollTimer = setTimeout(() => {
      state.scrollTimer = 0;
      saveProgressNow();
    }, 250);
  }, { passive: true });

  window.addEventListener('beforeunload', () => saveProgressNow(true));

  // ---------- 启动 ----------
  (async function startReader() {
    if (!D) {
      try {
        if (window.HLM_DATA_SOURCE && typeof window.HLM_DATA_SOURCE.load === 'function') {
          D = await window.HLM_DATA_SOURCE.load();
        }
      } catch (err) {
        console.error('读取本地书源失败:', err);
      }
    }
    if (!D || !Array.isArray(D.chapters) || !D.chapters.length) {
      if (window.HLM_DATA_SOURCE && typeof window.HLM_DATA_SOURCE.showImport === 'function') {
        window.HLM_DATA_SOURCE.showImport();
      } else if (boot) {
        boot.innerHTML = '';
        const t = document.createElement('div');
        t.className = 'boot-title';
        t.textContent = '数据载入失败';
        const s = document.createElement('div');
        s.className = 'boot-sub';
        s.textContent = '请确认 app/data.js 已生成';
        boot.append(t, s);
      }
      return;
    }
    window.HLM_DATA = D;
    // 移动端 AI 桥从全局读取同一份书页数据，避免再下载一份 book.json。
    window.HLM_BOOK = D;

    const prefs = readPrefs();
    const mobileLayout = isMobileLayout();
    state.tocOpen = mobileLayout
      ? false
      : (typeof prefs.tocOpen === 'boolean'
        ? prefs.tocOpen
        : (window.outerWidth || window.innerWidth) >= 1180);
    state.notesOpen = mobileLayout
      ? false
      : (typeof prefs.notesOpen === 'boolean' ? prefs.notesOpen : true);
    state.zoom = clampZoom(prefs.zoom ?? 1);

    applyPanelState();
    updateZoomLabel();
    buildToc();

    let persisted = null;
    if (desktop) {
      try {
        persisted = await desktop.getState();
      } catch (err) {
        console.error('读取阅读状态失败:', err);
      }
    }
    if (persisted) {
      if (Number.isFinite(Number(persisted.zoom))) state.zoom = clampZoom(persisted.zoom);
    } else if (prefs.zoom !== undefined) {
      state.zoom = clampZoom(prefs.zoom);
    }
    applyReadingSize(state.zoom);
    updateZoomLabel();
    if (desktop) desktop.setZoom(state.zoom);

    const progress = desktop
      ? ((persisted && persisted.progress) || null)
      : ((persisted && persisted.progress) || prefs.progress || null);
    let ci = 0;
    if (progress && Number.isInteger(progress.chapter) && D.chapters[progress.chapter]) {
      ci = progress.chapter;
    }

    try {
      renderChapter(ci, { progress, restoring: true });
      buildSearchIndexAsync();
    } catch (err) {
      console.error('启动失败:', err);
      if (boot) {
        boot.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'boot-title';
        title.textContent = '启动失败';
        const detail = document.createElement('div');
        detail.className = 'boot-sub';
        detail.textContent = String((err && err.message) || err);
        boot.append(title, detail);
      }
      return;
    }

    requestAnimationFrame(() => {
      if (boot) {
        boot.classList.add('hide');
        setTimeout(() => boot.remove(), 500);
      }
    });

    if (progress && (ci > 0 || (Number(progress.scrollTop) || 0) > 0)) {
      state.restoreToastTimer = setTimeout(() => {
        state.restoreToastTimer = 0;
        showToast(`已续读至 ${D.chapters[ci].label}`, 1600);
      }, 600);
    }

    window.__reader = {
      data: D,
      state,
      goChapter,
      openNote,
      backToList,
      setZoom,
      search: (query) => {
        els.searchInput.value = query;
        els.searchClear.hidden = !query;
        runSearch(query);
      },
      clearSearch: () => closeSearch(true),
      currentChapter: () => D.chapters[state.ci],
    };
  })();

  // AI 导读窗与正文之间的一个小接口：跳引用、取当前回次。
  window.HLM_READER = {
    get data() {
      return D;
    },
    goChapter,
    showToast,
    getCurrentChapter: () => (D && D.chapters[state.ci]) || null,
    getCurrentHui: () => {
      const chapter = D && D.chapters[state.ci];
      return chapter ? Number.parseInt(chapter.id, 10) : 1;
    },
    goToCitation: (hui, paragraph, endParagraph) => {
      if (!D || !Array.isArray(D.chapters)) return false;
      const index = huiToIndex(hui);
      const chapter = D.chapters[index];
      if (!chapter) return false;
      const total = chapter.paragraphs.length;
      let start = Number(paragraph);
      let end = endParagraph !== undefined ? Number(endParagraph) : start;
      if (!Number.isFinite(start)) start = 1;
      if (!Number.isFinite(end)) end = start;
      start = Math.max(1, Math.min(total, Math.trunc(start)));
      end = Math.max(1, Math.min(total, Math.trunc(end)));
      if (end < start) [start, end] = [end, start];
      const found = state.aiCitations.findIndex(
        (c) => c.index === index && c.start === start && c.end === end,
      );
      if (found >= 0) {
        focusAiCitation(found);
      } else {
        goChapter(index, { paragraph: start - 1 });
      }
      return true;
    },
    setAiCitations,
    clearAiCitations,
    followAiChapter,
    setAiReadingTask,
    clearAiReadingTask,
    endAiReadingSession,
  };
})();
