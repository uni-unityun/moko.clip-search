/* =============================================
   CLIP SEARCH SITE — script.js
   ============================================= */

const CONFIG = {
  dataPath: './data/clips.json',
};

let allClips = [];
let filtered  = [];
let displayCount = 30;
const PAGE_SIZE  = 30;

// DOM
const searchInput   = document.getElementById('searchInput');
const searchClear   = document.getElementById('searchClear');
const gameFilter    = document.getElementById('gameFilter');
const creatorFilter = document.getElementById('creatorFilter');
const sortSelect    = document.getElementById('sortSelect');
const randomBtn     = document.getElementById('randomBtn');
const clipGrid      = document.getElementById('clipGrid');
const emptyState    = document.getElementById('emptyState');
const loadingState  = document.getElementById('loadingState');
const resultCount   = document.getElementById('resultCount');
const totalCount    = document.getElementById('totalCount');
const resetBtn         = document.getElementById('resetBtn');
const clearFiltersBtn  = document.getElementById('clearFiltersBtn');

// モーダル
const modalOverlay  = document.getElementById('modalOverlay');
const modalClose    = document.getElementById('modalClose');
const modalThumb    = document.getElementById('modalThumb');
const modalLink     = document.getElementById('modalLink');
const modalGame     = document.getElementById('modalGame');
const modalTitle    = document.getElementById('modalTitle');
const modalViews    = document.getElementById('modalViews');
const modalDate     = document.getElementById('modalDate');
const modalDuration = document.getElementById('modalDuration');
const modalCreator  = document.getElementById('modalCreator');

// ============================================================
//  データ読み込み
// ============================================================
async function loadClips() {
  showLoading(true);
  try {
    const res = await fetch(CONFIG.dataPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allClips = await res.json();
    onDataReady();
  } catch (err) {
    console.error('読み込み失敗:', err);
    loadingState.innerHTML = `
      <div style="color:var(--pink)">⚠️ データの読み込みに失敗しました</div>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">
        <code>python -m http.server 8080</code> でサーバーを起動してください。
      </p>`;
  }
}

function onDataReady() {
  showLoading(false);
  populateGameFilter();
  populateCreatorFilter();
  totalCount.textContent = `${allClips.length} clips`;
  applyFiltersAndRender();
}

// ============================================================
//  フィルター選択肢を動的生成
// ============================================================
function populateGameFilter() {
  const games = [...new Set(allClips.map(c => c.game))].sort();
  games.forEach(game => {
    const opt = document.createElement('option');
    opt.value = game;
    opt.textContent = game;
    gameFilter.appendChild(opt);
  });
}

function populateCreatorFilter() {
  // creator_name が空のものは除外、件数順に並べる
  const countMap = {};
  allClips.forEach(c => {
    const name = c.creator_name;
    if (name) countMap[name] = (countMap[name] || 0) + 1;
  });

  const creators = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1])  // 件数が多い順
    .map(([name, count]) => ({ name, count }));

  creators.forEach(({ name, count }) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name}（${count}件）`;
    creatorFilter.appendChild(opt);
  });
}

// ============================================================
//  フィルター & ソート & レンダリング
// ============================================================
function applyFiltersAndRender() {
  const query   = searchInput.value.trim().toLowerCase();
  const game    = gameFilter.value;
  const creator = creatorFilter.value;
  const sort    = sortSelect.value;

  searchClear.classList.toggle('visible', query.length > 0);

  filtered = allClips.filter(clip => {
    const matchGame    = !game    || clip.game === game;
    const matchCreator = !creator || clip.creator_name === creator;
    const matchQuery   = !query   ||
      clip.title.toLowerCase().includes(query) ||
      clip.game.toLowerCase().includes(query)  ||
      (clip.creator_name && clip.creator_name.toLowerCase().includes(query));
    return matchGame && matchCreator && matchQuery;
  });

  filtered = sortClips(filtered, sort);
  displayCount = PAGE_SIZE;
  renderGrid(filtered);
  updateStatus(filtered.length, allClips.length, query, game, creator);
}

function sortClips(clips, sort) {
  return [...clips].sort((a, b) => {
    switch (sort) {
      case 'views_desc':    return b.views    - a.views;
      case 'views_asc':     return a.views    - b.views;
      case 'date_desc':     return new Date(b.created_at) - new Date(a.created_at);
      case 'date_asc':      return new Date(a.created_at) - new Date(b.created_at);
      case 'duration_desc': return b.duration - a.duration;
      case 'duration_asc':  return a.duration - b.duration;
      default: return 0;
    }
  });
}

// ============================================================
//  グリッド描画
// ============================================================
function renderGrid(clips) {
  clipGrid.innerHTML = '';
  if (clips.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const visible = clips.slice(0, displayCount);
  const fragment = document.createDocumentFragment();
  visible.forEach((clip, i) => fragment.appendChild(createCard(clip, i)));
  clipGrid.appendChild(fragment);

  // もっと見るボタン
  if (displayCount < clips.length) {
    const btn = document.createElement('button');
    btn.className = 'btn-load-more';
    btn.textContent = `もっと見る（残り ${clips.length - displayCount} 件）`;
    btn.addEventListener('click', () => {
      displayCount += PAGE_SIZE;
      renderGrid(clips);
    });
    clipGrid.appendChild(btn);
  }
}

function createCard(clip, index) {
  const article = document.createElement('article');
  article.className = 'clip-card';
  article.setAttribute('role', 'button');
  article.setAttribute('tabindex', '0');
  article.setAttribute('aria-label', clip.title);

  const creatorTag = clip.creator_name
    ? `<span class="card-creator-tag">✂️ ${escapeHtml(clip.creator_name)}</span>`
    : '';

  article.innerHTML = `
    <div class="card-thumb-wrap">
      <img
        class="card-thumb"
        src="${escapeAttr(clip.thumbnail_url)}"
        alt="${escapeAttr(clip.title)}"
        loading="${index < 6 ? 'eager' : 'lazy'}"
        decoding="async"
      />
      <div class="card-overlay">
        <div class="card-play-icon">▶</div>
      </div>
      <button class="card-copy-btn" title="リンクをコピー">🔗</button>
      <span class="card-duration">${formatDuration(clip.duration)}</span>
    </div>
    <div class="card-body">
      <span class="card-game-tag">${escapeHtml(clip.game)}</span>${creatorTag}
      <p class="card-title">${escapeHtml(clip.title)}</p>
      <div class="card-meta">
        <span class="card-views">👁 ${formatViews(clip.views)}</span>
        <span class="card-date">${formatDate(clip.created_at)}</span>
        <button class="card-copy-inline" title="リンクをコピー">🔗 コピー</button>
      </div>
    </div>
  `;

  // コピーボタン
  const copyBtn = article.querySelector('.card-copy-inline');
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(clip.clip_url);
      copyBtn.textContent = '✅ コピー完了';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = '🔗 コピー';
        copyBtn.classList.remove('copied');
      }, 2000);
    } catch {
      copyBtn.textContent = '❌ 失敗';
      setTimeout(() => { copyBtn.textContent = '🔗 コピー'; }, 2000);
    }
  });

  article.addEventListener('click', () => openModal(clip));
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(clip); }
  });

  return article;
}

// ============================================================
//  ステータス
// ============================================================
function updateStatus(count, total, query, game, creator) {
  let text = `${count.toLocaleString()} 件`;
  const filters = [];
  if (query)   filters.push(`"${query}"`);
  if (game)    filters.push(game);
  if (creator) filters.push(`✂️ ${creator}`);
  if (filters.length) text += ` — ${filters.join(' / ')}`;
  else text += ` / 全${total}件`;
  resultCount.textContent = text;
}

// ============================================================
//  ランダム
// ============================================================
function showRandomClip() {
  if (allClips.length === 0) return;
  const clip = allClips[Math.floor(Math.random() * allClips.length)];
  randomBtn.querySelector('.btn-random-icon').style.transform = 'rotate(360deg)';
  setTimeout(() => { randomBtn.querySelector('.btn-random-icon').style.transform = ''; }, 500);
  openModal(clip);
}

// ============================================================
//  モーダル
// ============================================================
function openModal(clip) {
  modalThumb.src             = clip.thumbnail_url;
  modalThumb.alt             = clip.title;
  modalLink.href             = clip.clip_url;
  modalGame.textContent      = clip.game;
  modalTitle.textContent     = clip.title;
  modalViews.textContent     = `👁 ${formatViews(clip.views)} 回視聴`;
  modalDate.textContent      = `📅 ${formatDate(clip.created_at)}`;
  modalDuration.textContent  = `⏱ ${formatDuration(clip.duration)}`;
  modalCreator.textContent   = clip.creator_name || '—';
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modalClose.focus();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ============================================================
//  ローディング
// ============================================================
function showLoading(bool) {
  loadingState.classList.toggle('hidden', !bool);
  clipGrid.classList.toggle('hidden', bool);
}

// ============================================================
//  フォーマット
// ============================================================
function formatViews(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) { return String(str).replace(/"/g, '&quot;'); }

// ============================================================
//  リセット
// ============================================================
function resetFilters() {
  searchInput.value   = '';
  gameFilter.value    = '';
  creatorFilter.value = '';
  sortSelect.value    = 'views_desc';
  applyFiltersAndRender();
}

// ============================================================
//  イベントリスナー
// ============================================================
let searchDebounceTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(applyFiltersAndRender, 180);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  applyFiltersAndRender();
});

gameFilter.addEventListener('change', applyFiltersAndRender);
creatorFilter.addEventListener('change', applyFiltersAndRender);
sortSelect.addEventListener('change', applyFiltersAndRender);
randomBtn.addEventListener('click', showRandomClip);
resetBtn.addEventListener('click', resetFilters);
clearFiltersBtn.addEventListener('click', resetFilters);

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ============================================================
//  起動
// ============================================================
loadClips();
