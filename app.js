// Simple Genius-like annotator for a single work, storing annotations in localStorage.
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

const STORAGE_KEY = 'philogenius_annotations_v1';

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
  renderText();
  restoreFromHash();
}

function renderText() {
  textContainer.innerHTML = '';
  docParagraphs.forEach(p => {
    const el = document.createElement('p');
    el.dataset.pid = p.id;
    el.dataset.original = p.text;
    el.textContent = p.text;
    textContainer.appendChild(el);
  });
  applyAllAnnotations();
}

function applyAllAnnotations() {
  // Re-apply all highlights per paragraph. Sort by start desc to keep offsets stable.
  const byPid = new Map();
  annotations.forEach(a => {
    if (!byPid.has(a.pid)) byPid.set(a.pid, []);
    byPid.get(a.pid).push(a);
  });
  for (const [pid, arr] of byPid) {
    const p = textContainer.querySelector(`p[data-pid="${pid}"]`);
    if (!p) continue;
    p.textContent = p.dataset.original;
    // Sort descending by start
    arr.sort((x,y) => y.start - x.start);
    arr.forEach(a => wrapOffsetsInParagraph(p, a.start, a.end, a.id));
  }
}

function wrapOffsetsInParagraph(pEl, start, end, annId) {
  // Walk text nodes, split at [start,end), wrap with span.annotation
  const walker = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT, null);
  let pos = 0;
  let startNode, startOffset, endNode, endOffset;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const nextPos = pos + n.textContent.length;
    if (start >= pos && start <= nextPos) { startNode = n; startOffset = start - pos; }
    if (end >= pos && end <= nextPos) { endNode = n; endOffset = end - pos; break; }
    pos = nextPos;
  }
  if (!startNode || !endNode) return;
  // Split end first
  if (endOffset !== endNode.textContent.length) endNode.splitText(endOffset);
  let nodeForWrap = startNode;
  if (startOffset !== 0) nodeForWrap = startNode.splitText(startOffset);
  // Now nodeForWrap up to before end is contiguous text nodes until we reach a boundary
  const span = document.createElement('span');
  span.className = 'annotation';
  span.dataset.annId = annId;
  // Collect nodes to wrap until we hit a boundary (next sibling is the split end boundary)
  let current = nodeForWrap;
  while (current && current !== endNode.nextSibling) {
    const next = current.nextSibling;
    span.appendChild(current);
    current = next;
  }
  // Insert span at the correct place
  const ref = endNode.nextSibling;
  pEl.insertBefore(span, ref);
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
  applyAllAnnotations();
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
  // Clear existing emphasis
  document.querySelectorAll('.searchHit').forEach(n => n.classList.remove('searchHit'));
  if (!q) return;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  textContainer.querySelectorAll('p').forEach(p => {
    // skip inside annotation spans; work on a cloned text to compute matches
    const full = p.dataset.original;
    let match;
    const hits = [];
    while ((match = re.exec(full)) !== null) {
      hits.push({start: match.index, end: match.index + match[0].length});
      if (hits.length > 2000) break;
    }
    // apply highlights from end to start
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      wrapOffsetsInParagraph(p, h.start, h.end, `search-${i}`);
      // mark the newly created span for styling
      const span = p.querySelector('span.annotation[data-ann-id="search-' + i + '"]') || p.querySelector('span.annotation'); // fallback
      if (span) span.classList.add('searchHit');
    }
  });
});

// Import/export
btnExport.addEventListener('click', () => {
  const data = JSON.stringify(annotations, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'annotations.json'; a.click();
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
      applyAllAnnotations();
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
  const src = linkAntichrist.dataset.src;
  loadText(src).catch(err => {
    textContainer.textContent = 'Failed to load the sample text. Add a public-domain text file under /texts and set the link.';
  });
});
