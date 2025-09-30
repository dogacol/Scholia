// Simple Scholia-like annotator for a single work, storing annotations in localStorage.
// Text is loaded from a plain UTF-8 file and split into paragraphs.
const textContainer = document.getElementById('textContainer');
const searchBox = document.getElementById('searchBox');
const linkAntichrist = document.getElementById('link-antichrist');
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

let docParagraphs = []; // [{id, text}]
let annotations = [];   // [{id, pid, start, end, exact, prefix, suffix, body, tags, createdAt}]
let currentSearchMatches = new Map(); // pid -> [{id, start, end}]

const STORAGE_KEY = 'scholia_annotations_v1';

function loadAnnotations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    annotations = raw ? JSON.parse(raw) : [];
  } catch { annotations = []; }
}
function saveAnnotations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
}

function uid() { return 'a_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

async function loadText(url) {
  const res = await fetch(url);
  const txt = await res.text();
  // Split into paragraphs by blank lines
  const paras = txt.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  docParagraphs = paras.map((t, i) => ({ id: `p${i+1}`, text: t.replace(/\s+/g,' ').trim() }));
  currentSearchMatches = new Map();
  if (searchBox) searchBox.value = '';
  renderText();
}

function renderText() {
  const annotationMap = new Map();
  annotations.forEach(a => {
    if (!annotationMap.has(a.pid)) annotationMap.set(a.pid, []);
    annotationMap.get(a.pid).push(a);
  });
  for (const arr of annotationMap.values()) {
    arr.sort((a, b) => a.start - b.start);
  }

  textContainer.innerHTML = '';
  docParagraphs.forEach(p => {
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
  paragraphAnnotations.forEach(a => {
    events.push({ pos: a.start, type: 'start', kind: 'annotation', item: a });
    events.push({ pos: a.end, type: 'end', kind: 'annotation', item: a });
  });
  searchHits.forEach(h => {
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

  events.forEach(ev => {
    const pos = Math.max(0, Math.min(text.length, ev.pos));
    if (pos > cursor) {
      html += wrapSegment(text.slice(cursor, pos));
      cursor = pos;
    }
    if (ev.type === 'end') {
      if (ev.kind === 'annotation') {
        const idx = openAnnotations.findIndex(a => a.id === ev.item.id);
        if (idx !== -1) openAnnotations.splice(idx, 1);
      } else {
        const idx = openSearches.findIndex(h => h.id === ev.item.id);
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
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  if (sel.isCollapsed) return null;
  return range;
}

function rangeToParagraphOffsets(range) {
  // Find paragraph element
  let container = range.commonAncestorContainer;
  while (container && container.nodeType === 3) container = container.parentElement;
  const p = container.closest('p[data-pid]');
  if (!p) return null;

  // Compute offsets within paragraph by summing text node lengths
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
  let pos = 0, start = -1, end = -1;
  const sc = range.startContainer, so = range.startOffset;
  const ec = range.endContainer, eo = range.endOffset;

  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n === sc) start = pos + so;
    if (n === ec) { end = pos + eo; break; }
    pos += n.textContent.length;
  }
  if (start === -1 || end === -1 || end <= start) return null;
  // Build TextQuoteSelector context
  const full = p.dataset.original;
  const exact = full.slice(start, end);
  const prefix = full.slice(Math.max(0, start - 30), start);
  const suffix = full.slice(end, Math.min(full.length, end + 30));
  return { pid: p.dataset.pid, start, end, exact, prefix, suffix };
}

// Annotate flow
let pendingSelection = null;

document.addEventListener('mouseup', (e) => {
  const range = getSelectionWithin(textContainer);
  if (!range) { hideAnnotateToolbar(); return; }
  const rect = range.getBoundingClientRect();
  showAnnotateToolbar(rect.left + window.scrollX, rect.top + window.scrollY - 10);
  pendingSelection = range;
}, true);

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
  if (!pendingSelection) return;
  const off = rangeToParagraphOffsets(pendingSelection);
  if (!off) { alert('Selection error. Try selecting within a single paragraph.'); return; }
  const ann = {
    id: uid(),
    pid: off.pid,
    start: off.start,
    end: off.end,
    exact: off.exact,
    prefix: off.prefix,
    suffix: off.suffix,
    body: noteBody.value.trim(),
    tags: noteTags.value.split(',').map(s=>s.trim()).filter(Boolean),
    createdAt: new Date().toISOString()
  };
  annotations.push(ann);
  saveAnnotations();
  renderText();
  hideAnnotateToolbar();
  openAnnotation(ann.id);
  // Clear selection
  window.getSelection().removeAllRanges();
});

document.getElementById('cancelAnnotate').addEventListener('click', hideAnnotateToolbar);

// Hover tooltip and click to open
textContainer.addEventListener('mouseover', (e) => {
  const span = e.target.closest('.annotation');
  if (!span) { tooltip.hidden = true; return; }
  const ann = annotations.find(a => a.id === span.dataset.annId);
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

function openAnnotation(annId) {
  const ann = annotations.find(a => a.id === annId);
  if (!ann) return;
  sidebar.style.display = 'block';
  annotationView.innerHTML = "";
  const header = document.createElement('div');
  header.innerHTML = `<div><strong>Selected:</strong> “${escapeHtml(ann.exact)}”</div>
  <div><small>${ann.tags.map(t=>`#${escapeHtml(t)}`).join(' ')}</small></div>
  <div><small>${new Date(ann.createdAt).toLocaleString()}</small></div>
  `;
  const body = document.createElement('div');
  body.style.marginTop = '0.5rem';
  body.textContent = ann.body;
  const link = document.createElement('div');
  link.style.marginTop = '0.75rem';
  const url = new URL(window.location.href);
  url.hash = `ann=${ann.id}`;
  link.innerHTML = `<a href="${url.toString()}">Link to this annotation</a>`;
  annotationView.appendChild(header);
  annotationView.appendChild(body);
  annotationView.appendChild(link);
  location.hash = `ann=${ann.id}`;
}

closeSidebar.addEventListener('click', () => {
  sidebar.style.display = 'block'; // keep layout but clear content
  annotationView.innerHTML = '<em>No annotation selected.</em>';
  // do not clear hash to allow sharing
});

function restoreFromHash() {
  const m = location.hash.match(/ann=([A-Za-z0-9_]+)/);
  if (m) openAnnotation(m[1]);
}

// Search
searchBox.addEventListener('input', () => {
  const q = searchBox.value.trim();
  if (!q) {
    currentSearchMatches = new Map();
    renderText();
    return;
  }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = new Map();
  docParagraphs.forEach(p => {
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
});

// Import/export
btnExport.addEventListener('click', () => {
  const data = JSON.stringify(annotations, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'scholia-annotations.json';
  a.click();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener('click', async () => {
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
      annotations = data;
      saveAnnotations();
      renderText();
      alert('Imported annotations.');
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  };
  input.click();
});

// Utility
function escapeHtml(s){return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}

// Load sample on click
linkAntichrist.addEventListener('click', (e) => {
  e.preventDefault();
  loadText(linkAntichrist.dataset.src).catch(err => alert('Failed to load text: '+err.message));
});

// Auto-load on first visit
window.addEventListener('DOMContentLoaded', () => {
  loadAnnotations();
  const src = linkAntichrist.dataset.src; // e.g., "antichrist_de_sample.txt" in same folder as index.html
  loadText(src).catch(err => {
    textContainer.textContent = 'Failed to load the sample text. Place a public-domain text file alongside index.html and set the link.';
  });
});