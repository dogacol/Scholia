// Simple Scholia-like annotator that supports a lightweight works directory
// and per-work annotation storage in localStorage.
const textContainer = document.getElementById('textContainer');
const searchBox = document.getElementById('searchBox');
const worksSearch = document.getElementById('worksSearch');
const worksList = document.getElementById('worksList');
const landing = document.getElementById('landing');
const readerShell = document.getElementById('readerShell');
const libraryLink = document.getElementById('libraryLink');
const sidebar = document.getElementById('sidebar');
const closeSidebar = document.getElementById('closeSidebar');
const annotationView = document.getElementById('annotationView');
const annotateToolbar = document.getElementById('annotateToolbar');
const annotateForm = document.getElementById('annotateForm');
const noteBody = document.getElementById('noteBody');
const noteTags = document.getElementById('noteTags');
const tooltip = document.getElementById('tooltip');
const btnImport = document.getElementById('btn-import');
const btnExport = document.getElementById('btn-export');

const worksDirectory = [
  {
    id: 'antichrist-1895-de',
    title: 'Der Antichrist',
    author: 'Friedrich Nietzsche',
    year: 1895,
    language: 'German',
    src: 'antichrist_de_sample.txt',
    description:
      'Sample selection from the 1895 German publication prepared for the annotation demo.'
  }
];

const defaultWorkId = worksDirectory[0]?.id || null;
const STORAGE_KEY = 'scholia_annotations_v2';

let docParagraphs = [];
let annotationsByWork = {};
let currentWork = null;
let currentSearchMatches = new Map();

function findWorkById(id) {
  if (!id) return null;
  return worksDirectory.find((work) => work.id === id) || null;
}

function readHashParams() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return {};
  return hash.split('&').reduce((acc, part) => {
    if (!part) return acc;
    const [k, v = ''] = part.split('=');
    if (!k) return acc;
    acc[decodeURIComponent(k)] = decodeURIComponent(v);
    return acc;
  }, {});
}

function buildHashFromParams(params) {
  const cleaned = {};
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === null || value === undefined || value === '') {
      return;
    }
    cleaned[key] = value;
  });
  const entries = Object.keys(cleaned)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(cleaned[key])}`);
  return entries.length ? `#${entries.join('&')}` : '';
}

function updateUrlHash(updates = {}) {
  const params = { ...readHashParams(), ...updates };
  const newHash = buildHashFromParams(params);
  const newUrl = `${window.location.pathname}${window.location.search}${newHash}`;
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', newUrl);
  }
}

function loadAnnotations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      annotationsByWork = parsed;
    } else {
      annotationsByWork = {};
    }
  } catch {
    annotationsByWork = {};
  }
  Object.keys(annotationsByWork).forEach((key) => {
    if (!Array.isArray(annotationsByWork[key])) {
      annotationsByWork[key] = [];
    }
  });
}

function saveAnnotations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(annotationsByWork));
}

function ensureAnnotationBucket(workId) {
  if (!workId) return [];
  if (!Array.isArray(annotationsByWork[workId])) {
    annotationsByWork[workId] = [];
  }
  return annotationsByWork[workId];
}

function getAnnotationsForCurrentWork() {
  return currentWork ? ensureAnnotationBucket(currentWork.id) : [];
}

function uid() {
  return 'a_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function showLanding() {
  if (landing) landing.hidden = false;
  if (readerShell) readerShell.hidden = true;
}

function showReaderShell() {
  if (landing) landing.hidden = true;
  if (readerShell) readerShell.hidden = false;
}

function renderWorksDirectory(filterText = '') {
  if (!worksList) return;
  const query = filterText.trim().toLowerCase();
  const filtered = query
    ? worksDirectory.filter((work) => {
        const haystack = [
          work.title,
          work.author,
          work.year ? String(work.year) : '',
          work.language || '',
          work.description || ''
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
    : worksDirectory.slice();

  if (!filtered.length) {
    worksList.innerHTML = '<li class="works-list__empty">No works match that search.</li>';
    return;
  }

  const markup = filtered
    .map((work) => {
      const meta = [work.author, work.year, work.language].filter(Boolean).join(' · ');
      const metaMarkup = meta ? `<span class="works-list__meta">${escapeHtml(meta)}</span>` : '';
      const description = work.description
        ? `<span class="works-list__description">${escapeHtml(work.description)}</span>`
        : '';
      return `<li class="works-list__item" data-work-id="${work.id}">
        <button type="button" class="works-list__link" data-work-id="${work.id}" aria-pressed="false">
          <span class="works-list__title">${escapeHtml(work.title)}</span>
          ${metaMarkup}
          ${description}
        </button>
      </li>`;
    })
    .join('');
  worksList.innerHTML = markup;
  updateActiveWorkUI(currentWork?.id || null);
}

function updateActiveWorkUI(activeId) {
  if (!worksList) return;
  worksList.querySelectorAll('[data-work-id]').forEach((item) => {
    const workId = item.dataset.workId;
    const isActive = workId === activeId;
    if (item.classList.contains('works-list__item')) {
      item.classList.toggle('works-list__item--active', isActive);
    }
    if (item.tagName === 'BUTTON') {
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    } else {
      const button = item.querySelector('button[data-work-id]');
      if (button) {
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
    }
  });
}

async function loadText(work) {
  if (!work) return;
  if (currentWork && work.id === currentWork.id && docParagraphs.length) {
    showReaderShell();
    updateActiveWorkUI(work.id);
    updateUrlHash({ work: work.id });
    return;
  }

  try {
    const res = await fetch(work.src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    const paras = txt
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    docParagraphs = paras.map((t, i) => ({
      id: `p${i + 1}`,
      text: t.replace(/\s+/g, ' ').trim()
    }));
    currentSearchMatches = new Map();
    if (searchBox) searchBox.value = '';
    currentWork = work;
    showReaderShell();
    updateActiveWorkUI(work.id);
    renderText();
    updateUrlHash({ work: work.id, ann: null });
  } catch (err) {
    alert('Failed to load text: ' + err.message);
    throw err;
  }
}

function renderText() {
  if (!textContainer) return;
  const annotations = getAnnotationsForCurrentWork();
  const annotationMap = new Map();
  annotations.forEach((a) => {
    if (!annotationMap.has(a.pid)) annotationMap.set(a.pid, []);
    annotationMap.get(a.pid).push(a);
  });
  for (const arr of annotationMap.values()) {
    arr.sort((a, b) => a.start - b.start);
  }

  textContainer.innerHTML = '';
  if (!currentWork || !docParagraphs.length) {
    tooltip.hidden = true;
    return;
  }

  docParagraphs.forEach((p) => {
    const el = document.createElement('p');
    el.dataset.pid = p.id;
    el.dataset.original = p.text;
    const anns = annotationMap.get(p.id) || [];
    const hits = currentSearchMatches.get(p.id) || [];
    el.innerHTML = buildParagraphHTML(p.text, anns, hits);
    textContainer.appendChild(el);
  });
  tooltip.hidden = true;
  restoreFromHash();
}

function buildParagraphHTML(text, paragraphAnnotations, searchHits) {
  if (!text) return '';
  const events = [];
  paragraphAnnotations.forEach((a) => {
    events.push({ pos: a.start, type: 'start', kind: 'annotation', item: a });
    events.push({ pos: a.end, type: 'end', kind: 'annotation', item: a });
  });
  searchHits.forEach((h) => {
    events.push({ pos: h.start, type: 'start', kind: 'search', item: h });
    events.push({ pos: h.end, type: 'end', kind: 'search', item: h });
  });
  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.type !== b.type) return a.type === 'end' ? -1 : 1;
    const orderStart = { annotation: 0, search: 1 };
    const orderEnd = { search: 0, annotation: 1 };
    if (a.type === 'start') {
      return orderStart[a.kind] - orderStart[b.kind];
    }
    return orderEnd[a.kind] - orderEnd[b.kind];
  });

  let html = '';
  let cursor = 0;
  const openAnnotations = [];
  const openSearches = [];

  function wrapSegment(segment) {
    if (!segment) return '';
    let chunk = escapeHtml(segment);
    for (let i = openSearches.length - 1; i >= 0; i--) {
      const hit = openSearches[i];
      chunk = `<mark class="searchHit" data-search-id="${hit.id}">${chunk}</mark>`;
    }
    for (let i = openAnnotations.length - 1; i >= 0; i--) {
      const ann = openAnnotations[i];
      chunk = `<span class="annotation" data-ann-id="${ann.id}">${chunk}</span>`;
    }
    return chunk;
  }

  events.forEach((ev) => {
    const pos = Math.max(0, Math.min(text.length, ev.pos));
    if (pos > cursor) {
      html += wrapSegment(text.slice(cursor, pos));
      cursor = pos;
    }
    if (ev.type === 'end') {
      if (ev.kind === 'annotation') {
        const idx = openAnnotations.findIndex((a) => a.id === ev.item.id);
        if (idx !== -1) openAnnotations.splice(idx, 1);
      } else {
        const idx = openSearches.findIndex((h) => h.id === ev.item.id);
        if (idx !== -1) openSearches.splice(idx, 1);
      }
    } else {
      if (ev.kind === 'annotation') {
        openAnnotations.push(ev.item);
      } else {
        openSearches.push(ev.item);
      }
    }
  });
  if (cursor < text.length) {
    html += wrapSegment(text.slice(cursor));
  }
  return html || escapeHtml(text);
}

function getSelectionWithin(el) {
  if (!el) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  if (sel.isCollapsed) return null;
  return range;
}

function rangeToParagraphOffsets(range) {
  let container = range.commonAncestorContainer;
  while (container && container.nodeType === 3) container = container.parentElement;
  const p = container ? container.closest('p[data-pid]') : null;
  if (!p) return null;

  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
  let pos = 0,
    start = -1,
    end = -1;
  const sc = range.startContainer,
    so = range.startOffset;
  const ec = range.endContainer,
    eo = range.endOffset;

  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === sc) start = pos + so;
    if (n === ec) {
      end = pos + eo;
      break;
    }
    pos += n.textContent.length;
  }
  if (start === -1 || end === -1 || end <= start) return null;
  const full = p.dataset.original;
  const exact = full.slice(start, end);
  const prefix = full.slice(Math.max(0, start - 30), start);
  const suffix = full.slice(end, Math.min(full.length, end + 30));
  return { pid: p.dataset.pid, start, end, exact, prefix, suffix };
}

let pendingSelection = null;

document.addEventListener(
  'mouseup',
  (e) => {
    if (!textContainer) return;
    if (!currentWork) {
      hideAnnotateToolbar();
      return;
    }
    const range = getSelectionWithin(textContainer);
    if (!range) {
      hideAnnotateToolbar();
      return;
    }
    const rect = range.getBoundingClientRect();
    showAnnotateToolbar(rect.left + window.scrollX, rect.top + window.scrollY - 10);
    pendingSelection = range;
  },
  true
);

function showAnnotateToolbar(x, y) {
  annotateToolbar.style.left = `${x}px`;
  annotateToolbar.style.top = `${y}px`;
  annotateToolbar.style.display = 'block';
  noteBody.value = '';
  noteTags.value = '';
  noteBody.focus();
}
function hideAnnotateToolbar() {
  annotateToolbar.style.display = 'none';
  pendingSelection = null;
}

annotateForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingSelection || !currentWork) return;
  const off = rangeToParagraphOffsets(pendingSelection);
  if (!off) {
    alert('Selection error. Try selecting within a single paragraph.');
    return;
  }
  const ann = {
    id: uid(),
    pid: off.pid,
    start: off.start,
    end: off.end,
    exact: off.exact,
    prefix: off.prefix,
    suffix: off.suffix,
    body: noteBody.value.trim(),
    tags: noteTags.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    createdAt: new Date().toISOString()
  };
  const bucket = ensureAnnotationBucket(currentWork.id);
  bucket.push(ann);
  saveAnnotations();
  renderText();
  hideAnnotateToolbar();
  openAnnotation(ann.id);
  window.getSelection().removeAllRanges();
});

document.getElementById('cancelAnnotate').addEventListener('click', hideAnnotateToolbar);

if (textContainer) {
  textContainer.addEventListener('mouseover', (e) => {
    const span = e.target.closest('.annotation');
    if (!span) {
      tooltip.hidden = true;
      return;
    }
    const ann = getAnnotationsForCurrentWork().find((a) => a.id === span.dataset.annId);
    if (!ann) return;
    tooltip.textContent = ann.body.slice(0, 220);
    tooltip.hidden = false;
    const r = span.getBoundingClientRect();
    tooltip.style.left = `${window.scrollX + r.left}px`;
    tooltip.style.top = `${window.scrollY + r.top - 28}px`;
  });
  textContainer.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    if (!to || !tooltip.contains(to)) tooltip.hidden = true;
  });

  textContainer.addEventListener('click', (e) => {
    const span = e.target.closest('.annotation');
    if (!span) return;
    openAnnotation(span.dataset.annId);
  });
}

function openAnnotation(annId) {
  if (!currentWork) return;
  const ann = getAnnotationsForCurrentWork().find((a) => a.id === annId);
  if (!ann) return;
  sidebar.style.display = 'block';
  annotationView.innerHTML = '';
  const header = document.createElement('div');
  header.innerHTML = `<div><strong>Selected:</strong> “${escapeHtml(ann.exact)}”</div>
  <div><small>${ann.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</small></div>
  <div><small>${new Date(ann.createdAt).toLocaleString()}</small></div>`;
  const body = document.createElement('div');
  body.style.marginTop = '0.5rem';
  body.textContent = ann.body;
  const link = document.createElement('div');
  link.style.marginTop = '0.75rem';
  const hash = buildHashFromParams({ work: currentWork.id, ann: ann.id });
  const href = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
  link.innerHTML = `<a href="${href}">Permalink to this annotation</a>`;
  annotationView.appendChild(header);
  annotationView.appendChild(body);
  annotationView.appendChild(link);
  updateUrlHash({ work: currentWork.id, ann: ann.id });
}

closeSidebar.addEventListener('click', () => {
  sidebar.style.display = 'block';
  annotationView.innerHTML = '<em>No annotation selected.</em>';
});

function restoreFromHash() {
  const params = readHashParams();
  if (params.ann) {
    openAnnotation(params.ann);
  }
}

function handleSearchInput() {
  if (!currentWork) return;
  const q = searchBox.value.trim();
  if (!q) {
    currentSearchMatches = new Map();
    renderText();
    return;
  }
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const matches = new Map();
  docParagraphs.forEach((p) => {
    const arr = [];
    let match;
    while ((match = re.exec(p.text)) !== null) {
      arr.push({ id: `${p.id}-search-${arr.length}`, start: match.index, end: match.index + match[0].length });
      if (arr.length > 2000) break;
    }
    if (arr.length) {
      matches.set(p.id, arr);
    }
  });
  currentSearchMatches = matches;
  renderText();
}

if (searchBox) {
  searchBox.addEventListener('input', handleSearchInput);
}

if (worksSearch) {
  worksSearch.addEventListener('input', () => {
    renderWorksDirectory(worksSearch.value || '');
  });
}

if (worksList) {
  worksList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-work-id]');
    if (!button) return;
    const work = findWorkById(button.dataset.workId);
    if (!work) return;
    loadText(work).catch((err) => console.error(err));
  });
}

if (libraryLink) {
  libraryLink.addEventListener('click', (event) => {
    event.preventDefault();
    currentWork = null;
    docParagraphs = [];
    currentSearchMatches = new Map();
    hideAnnotateToolbar();
    if (annotationView) {
      annotationView.innerHTML = '<em>No annotation selected.</em>';
    }
    renderText();
    updateActiveWorkUI(null);
    updateUrlHash({ work: null, ann: null });
    showLanding();
  });
}

function handleHashChange() {
  const params = readHashParams();
  const targetWork = params.work ? findWorkById(params.work) : null;
  const annId = params.ann || null;
  if (targetWork && (!currentWork || targetWork.id !== currentWork.id)) {
    loadText(targetWork)
      .then(() => {
        if (annId) openAnnotation(annId);
      })
      .catch((err) => console.error(err));
    return;
  }
  if (annId && currentWork) {
    openAnnotation(annId);
    return;
  }
  if (!targetWork && !annId) {
    currentWork = null;
    docParagraphs = [];
    currentSearchMatches = new Map();
    hideAnnotateToolbar();
    if (annotationView) {
      annotationView.innerHTML = '<em>No annotation selected.</em>';
    }
    renderText();
    updateActiveWorkUI(null);
    showLanding();
  }
}

window.addEventListener('hashchange', handleHashChange);

if (btnExport) {
  btnExport.addEventListener('click', () => {
    if (!currentWork) {
      alert('Open a work before exporting annotations.');
      return;
    }
    const data = JSON.stringify(getAnnotationsForCurrentWork(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentWork.id}-annotations.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

if (btnImport) {
  btnImport.addEventListener('click', () => {
    if (!currentWork) {
      alert('Open a work before importing annotations.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('Invalid file');
        annotationsByWork[currentWork.id] = data;
        saveAnnotations();
        renderText();
        alert('Imported annotations.');
      } catch (e) {
        alert('Import failed: ' + e.message);
      }
    };
    input.click();
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

window.addEventListener('DOMContentLoaded', () => {
  loadAnnotations();
  renderWorksDirectory(worksSearch ? worksSearch.value || '' : '');
  const params = readHashParams();
  const initialWork = params.work
    ? findWorkById(params.work)
    : defaultWorkId
    ? findWorkById(defaultWorkId)
    : null;
  if (initialWork) {
    loadText(initialWork)
      .then(() => {
        if (params.ann) openAnnotation(params.ann);
      })
      .catch((err) => {
        if (textContainer) {
          textContainer.textContent =
            'Failed to load the sample text. Place a public-domain text file alongside index.html and set the link.';
        }
        console.error(err);
      });
  } else {
    showLanding();
  }
});
