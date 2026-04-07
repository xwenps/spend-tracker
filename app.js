import { initTheme } from './theme.js';

window.cycleText = function(element, texts) {
  const current = element.textContent.trim();
  const index = texts.indexOf(current);
  element.textContent = texts[(index + 1) % texts.length];
};

// ─── USER MENU ────────────────────────────────────────────────────────────────
async function fetchUserProfile(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return;
    const p = await res.json();
    const user = {
      name:    p.name    || p.email || 'User',
      email:   p.email   || '',
      picture: p.picture || null,
    };
    sessionStorage.setItem('gapi_user_profile', JSON.stringify(user)); // ← cache it
    setUserMenu(user);
  } catch(e) {
    console.log('Failed to get user info.');
  }
}

function setUserMenu(user) {
  document.getElementById('user-menu-name').textContent = user.name;
  document.getElementById('ud-name').textContent  = user.name;
  document.getElementById('ud-email').textContent = user.email;

  const avatarEl = document.getElementById('user-avatar');

  if (user.picture) {
    // Bump Google's size token to 2× container size for crisp rendering
    const src = user.picture.replace(/=s\d+-c$/, '=s56-c');

    const img = document.createElement('img');
    img.alt              = user.name;
    img.crossOrigin      = 'anonymous'; // avoids taint issues
    img.src              = src;
    img.style.width      = '100%';
    img.style.height     = '100%';
    img.style.objectFit  = 'cover';
    img.style.borderRadius = '50%';

    avatarEl.innerHTML = ''; // clear the initials span
    avatarEl.appendChild(img);
  } else {
    const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('user-initials').textContent = initials;
  }
}

(function initUserMenuToggle() {
  const menuWrap = document.getElementById('user-menu');
  const menuBtn  = document.getElementById('user-menu-btn');
  const dropdown = document.getElementById('user-dropdown-menu');

  function closeMenu() {
    menuWrap.classList.remove('open');
    dropdown.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    menuWrap.classList.add('open');
    dropdown.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.contains('open') ? closeMenu() : openMenu();
  });
  dropdown.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeMenu);
})();

// ─── CONFIG / ENV LOADING ──────────────────────────────────────────────────────
async function loadConfig() {

  let prefilled = false;

  try {
    const res = await fetch('./config.json');
    if (!res.ok) throw new Error('no config');
    CONFIG = await res.json();
    if (CONFIG.clientId) { document.getElementById('client-id-input').value = CONFIG.clientId; prefilled = true; }
    if (CONFIG.sheetId)  { document.getElementById('sheet-id-input').value  = CONFIG.sheetId;  prefilled = true; }
    if (prefilled) document.getElementById('config-status').style.display = 'block';
  } catch {
    console.log("No pre-fillable config.json found.");
  }

  if (!prefilled && typeof window !== 'undefined' && window.ENV) {
    const env = window.ENV;
    if (env?.CLIENT_ID)   { document.getElementById('client-id-input').value = env.CLIENT_ID;   prefilled = true; }
    if (env?.SHEET_ID_DATA) { document.getElementById('sheet-id-input').value = env.SHEET_ID_DATA; prefilled = true; }
    if (prefilled) { document.getElementById('env-status').style.display = 'block'; console.log("Pre-filled from ENV."); }
  }

  if (!prefilled) {
    document.getElementById('manual-settings-panel').classList.add('open');
  }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let CONFIG = {};
let accessToken = null;
let allData = [];
let filteredData = [];
let sortCol = 'date';
let sortDir = 'desc';
let currentPage = 1;
const PAGE_SIZE = 25;
const MAX_DAILY_CT = 200;
let charts = {};
let categoryMap = {};
let subcategoryMap = {}; 
let activeDrillCategory = null;
let selectedTags = new Set();
let tagFilterMode = 'AND'; // 'AND' | 'OR'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PALETTE = [
  '#6c63ff','#ff6584','#43e97b','#f7971e','#38f9d7','#fa709a',
  '#a18cd1','#ffecd2','#96fbc4','#f093fb','#4facfe','#43cbff'
];

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  initTheme();
  await loadConfig();

  // ── Restore existing session ──────────────────────────────────
  const savedToken   = sessionStorage.getItem('gapi_access_token');
  const savedSheetId = sessionStorage.getItem('gapi_sheet_id');
  if (savedToken && savedSheetId) {
    accessToken = savedToken;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('loading').style.display   = 'block';
    const cachedProfile = sessionStorage.getItem('gapi_user_profile');
    if (cachedProfile) {
      setUserMenu(JSON.parse(cachedProfile));
    } else {
      await fetchUserProfile(savedToken);
    }
    await loadAllData(savedSheetId);
    return; 
  }

  // ── No session — show sign-in as normal ───────────────────────
  document.getElementById('signin-btn').addEventListener('click', startSignIn);
  // Demo Mode button wiring
  const demoBtn = document.getElementById('demo-mode-btn');
  const demoOverlay = document.getElementById('demo-overlay');
  const demoClose = document.getElementById('demo-close');
  const demoCancel = document.getElementById('demo-cancel');
  const demoLoad = document.getElementById('demo-load-btn');
  const demoSheetInput = document.getElementById('demo-sheet-id');
  const demoGidsInput = document.getElementById('demo-gids');
  if (demoBtn) demoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Prefill public demo values
    if (demoSheetInput) demoSheetInput.value = '1Ub6uzHLCIEj7f4zMVY96VhFcR3gRoz9xt9j8hp86oLk';
    if (demoGidsInput) demoGidsInput.value = '0,1978512565';
    if (demoOverlay) demoOverlay.style.display = 'flex';
    if (demoSheetInput) demoSheetInput.focus();
  });
  if (demoClose) demoClose.addEventListener('click', () => demoOverlay.style.display = 'none');
  if (demoCancel) demoCancel.addEventListener('click', () => demoOverlay.style.display = 'none');
  if (demoOverlay) demoOverlay.addEventListener('click', (e) => { if (e.target === demoOverlay) demoOverlay.style.display = 'none'; });
  if (demoLoad) demoLoad.addEventListener('click', async () => {
    const sid = (demoSheetInput && demoSheetInput.value || '').trim();
    const gids = (demoGidsInput && demoGidsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!sid || gids.length === 0) { alert('Please enter sheet ID and at least one gid'); return; }
    demoOverlay.style.display = 'none';
    await loadPublicData(sid, gids);
  });
  const settingsToggle = document.getElementById('manual-settings-toggle');
  const settingsPanel  = document.getElementById('manual-settings-panel');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      const isOpen = settingsPanel.classList.toggle('open');
      settingsToggle.textContent = isOpen ? '✕ hide setup' : '⚙ manual setup';
    });
  }
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
let tokenClient;

function startSignIn() {
  const clientId = document.getElementById('client-id-input').value.trim();
  const sheetId  = document.getElementById('sheet-id-input').value.trim();
  if (!clientId) { showAuthError('Please enter your OAuth Client ID.'); return; }
  if (!sheetId)  { showAuthError('Please enter your Google Sheet ID.'); return; }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ].join(' '),
    callback: async (resp) => {
      if (resp.error) { showAuthError('Sign-in failed: ' + resp.error); return; }
      accessToken = resp.access_token;
      sessionStorage.setItem('gapi_access_token', resp.access_token);
      sessionStorage.setItem('gapi_sheet_id', sheetId);
      fetchUserProfile(accessToken);
      await loadAllData(sheetId);
    }
  });
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ─── DATA FETCHING ────────────────────────────────────────────────────────────
let appButtonsWired = false;

function wireAppButtons() {
  if (appButtonsWired) return;
  appButtonsWired = true;
  initAllMultiSelects();

  document.getElementById('cat-type-btn').addEventListener('click', () => {
    document.getElementById('cat-type-overlay').style.display = 'flex';
  });
  document.getElementById('cat-type-close').addEventListener('click', () => {
    document.getElementById('cat-type-overlay').style.display = 'none';
  });
  document.getElementById('cat-type-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('cat-type-overlay'))
      document.getElementById('cat-type-overlay').style.display = 'none';
  });
  document.getElementById('freq-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.freq-btn');
    if (!btn) return;
    if (btn.dataset.freq === 'daily' && filteredData.length > MAX_DAILY_CT) {
      showToast(`Too many transactions for daily view (${filteredData.length} > ${MAX_DAILY_CT})`);
      return;
    }
    chartFreq = btn.dataset.freq;
    document.querySelectorAll('.freq-btn').forEach(b => b.classList.toggle('active', b === btn));
    updateChartTitles();
    renderCharts();
  });
  document.getElementById('drill-close').addEventListener('click', () => {
    document.getElementById('subcategory-drill-card').style.display = 'none';
    destroyChart('subDrill');
    activeDrillCategory = null;
  });
  document.getElementById('refresh-btn').addEventListener('click', () => {
    const sheetId = sessionStorage.getItem('gapi_sheet_id');
    if (sheetId && accessToken) loadAllData(sheetId);
  });
  document.getElementById('signout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('gapi_access_token');
    sessionStorage.removeItem('gapi_sheet_id');
    sessionStorage.removeItem('gapi_user_profile');
    location.reload();
  });
}

async function discoverSheetTabs(sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) {
    // Token likely expired — clear session and force re-login
    if (res.status === 401) {
      sessionStorage.removeItem('gapi_access_token');
      sessionStorage.removeItem('gapi_sheet_id');
      sessionStorage.removeItem('gapi_user_profile');
      location.reload();
    }
    throw new Error(`Sheet API error: ${res.status}`);
  }

  const json = await res.json();
  if (!json.sheets) throw new Error('No sheets found in response');
  return json.sheets.map(s => s.properties.title);
}

async function loadCategoryMap(sheetId) {
  try {
    const range = encodeURIComponent('CONFIG.categories!A:Z');
    const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return;
    const rows  = (await res.json()).values;
    if (!rows || rows.length < 2) return;
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const col = name => headers.indexOf(name);
    if (col('category_id') === -1) return;
    rows.slice(1).forEach(r => {
      const catId   = (r[col('category_id')]      || '').trim();
      const catName = (r[col('category_name')]    || '').trim();
      const subId   = (r[col('subcategory_id')]   || '').trim();
      const subName = (r[col('subcategory_name')] || '').trim();
      if (catId && catName) categoryMap[catId] = catName;
      if (catId && subId && subName) subcategoryMap[`${catId}::${subId}`] = subName;
    });
    console.log('[category] map loaded:', Object.keys(categoryMap).length, 'categories');
  } catch(e) {
    console.warn('Could not load CONFIG.categories:', e);
  }
}

async function loadAllData(sheetId) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('loading').style.display = 'block';

  categoryMap    = {};
  subcategoryMap = {};
  await loadCategoryMap(sheetId);

  // Get Data from either Config File or only tabs named as 4-digit years only (e.g. "2020", "2021", etc.)
  const allTabs = await discoverSheetTabs(sheetId);
  const sheetTabs = CONFIG.sheetTabs 
    ?? allTabs.filter(name => /^\d{4}$/.test(name));

  const results = await Promise.all(
    sheetTabs.map(async tab => {
      try {
        const range = encodeURIComponent(`${tab}!A:Z`);
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        console.log(`Tab "${tab}" → HTTP ${res.status}`);
        if (!res.ok) return [];
        const json = await res.json();
        const rows = json.values;
        console.log(`Tab "${tab}" → rows:`, rows?.length);
        if (!rows || rows.length < 2) return [];

        const headers = rows[0].map(h => h.trim().toLowerCase());
        console.log(`Tab "${tab}" → headers:`, headers);
        const idx = {
          date:          headers.indexOf('date'),
          description:   headers.indexOf('description'),
          amount:        headers.indexOf('amount'),
          account:       headers.indexOf('account'),
          accountOwner:  headers.indexOf('account owner'),
          notes:         headers.indexOf('notes'),
          categoryId:    headers.indexOf('category_id'),
          subcategoryId: headers.indexOf('subcategory_id'),
          tags:          headers.indexOf('tags'),
        };

        return rows.slice(1).flatMap(r => {
          const amount = parseFloat((r[idx.amount] || '0').replace(/[$,]/g, ''));
          if (!r[idx.date] || isNaN(amount) || amount === 0) return [];
          const parts   = r[idx.date].split('/');
          const dateObj = parts.length === 3
            ? new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]))
            : null;

          const rawCatId = idx.categoryId    >= 0 ? (r[idx.categoryId]    || '').trim() : '';
          const rawSubId = idx.subcategoryId >= 0 ? (r[idx.subcategoryId] || '').trim() : '';
          const rawTags  = idx.tags          >= 0 ? (r[idx.tags]          || '').trim() : '';

          const category  = (rawCatId && categoryMap[rawCatId])
            ? categoryMap[rawCatId] : (rawCatId || 'Uncategorized');
          const subcategory = (rawCatId && rawSubId && subcategoryMap[`${rawCatId}::${rawSubId}`])
            ? subcategoryMap[`${rawCatId}::${rawSubId}`] : (rawSubId || '');
          const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

          return [{
            date:         r[idx.date]        || '',
            dateObj,
            year:         dateObj ? dateObj.getFullYear()  : null,
            monthNum:     dateObj ? dateObj.getMonth() + 1 : null,
            description:  idx.description  >= 0 ? (r[idx.description]  || '') : '',
            amount,
            account:      idx.account      >= 0 ? (r[idx.account]      || '') : '',
            accountOwner: idx.accountOwner >= 0 ? (r[idx.accountOwner] || '') : '',
            notes:        idx.notes        >= 0 ? (r[idx.notes]        || '') : '',
            categoryId:   rawCatId,
            category,         // display name — used everywhere existing code references r.category
            subcategoryId: rawSubId,
            subcategory,
            tags,
          }];
        });

      } catch (e) {
        console.warn(`Could not load sheet tab "${tab}"`, e);
        return [];
      }
    })
  );
  console.log('sheetTabs used:', sheetTabs);
  console.log('results:', results);
  console.log('allData after flat:', results.flat().length, 'rows');

  allData = results.flat().sort((a, b) => (b.dateObj || 0) - (a.dateObj || 0));
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  populateFilters();
  applyFiltersAndRender();
  wireAppButtons();
}


// ─── FILTERS ──────────────────────────────────────────────────────────────────
function populateFilters() {
  const years = [...new Set(allData.map(r => r.year))].sort((a,b) => b-a);
  populateMSOptions('year', years.map(y => ({ value: String(y), label: String(y) })));

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthNums = new Set(allData.map(r => r.monthNum).filter(Boolean));
  const months = MONTH_NAMES.map((name,i) => ({ value: String(i+1), label: name })).filter(m => monthNums.has(parseInt(m.value)));
  populateMSOptions('month', months);

  const owners = [...new Set(allData.map(r => r.accountOwner).filter(Boolean))].sort();
  populateMSOptions('owner', owners.map(o => ({ value: o, label: o })));

  const cats = [...new Set(allData.map(r => r.category))].sort();
  populateMSOptions('cat', cats.map(c => ({ value: c, label: c })));

  const allTags = [...new Set(allData.flatMap(r => r.tags))].sort();
  populateMSOptions('tag', allTags.map(t => ({ value: t, label: t })));

  buildCategoryTypeDefaults(cats);
  renderCategoryTypeModal(cats);
}

function applyFiltersAndRender() {
  const savedScrollY = window.scrollY;
  filteredData = allData.filter(r => {
    if (excluded.year.size  > 0 && excluded.year.has(String(r.year)))      return false;
    if (excluded.month.size > 0 && excluded.month.has(String(r.monthNum))) return false;
    if (excluded.owner.size > 0 && excluded.owner.has(r.accountOwner))     return false;
    if (excluded.cat.size   > 0 && excluded.cat.has(r.category))           return false;

    if (selectedTags.size > 0) {
      if (tagFilterMode === 'AND') {
        if (![...selectedTags].every(t => (r.tags || []).includes(t))) return false;
      } else {
        if (![...selectedTags].some(t => (r.tags || []).includes(t))) return false;
      }
    }
    return true;
  });
  if (chartFreq === 'daily' && filteredData.length > MAX_DAILY_CT) {
    chartFreq = 'monthly';
    document.querySelectorAll('.freq-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.freq === 'monthly')
    );
    showToast(`Too many transactions for daily view — switched to Monthly`);
  }
  currentPage = 1;
  renderKPIs();
  updateChartTitles();
  renderCharts();
  renderTable();
  if (activeDrillCategory) renderSubcategoryDrill(activeDrillCategory, false);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.scrollTo({ top: savedScrollY, behavior: 'instant' });
  }));
}

// ─── DEMO / PUBLIC SHEETS LOADING ───────────────────────────────────────────
// Parse CSV text into array of rows (handles quoted fields)
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i+1];
    if (ch === '"') {
      if (inQuotes && next === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cur.push(field); field = ''; continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); cur = []; field = ''; }
      if (ch === '\r' && next === '\n') i++;
      continue;
    }
    field += ch;
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.map(r => r.map(c => c.trim()));
}

async function loadPublicData(sheetId, gids) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('loading').style.display = 'block';
  categoryMap    = {};
  subcategoryMap = {};
  await loadCategoryMap(sheetId);
  const combined = [];
  for (const gid of gids) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
      const res = await fetch(url);
      if (!res.ok) { console.warn('Failed to fetch gid', gid); continue; }
      const text = await res.text();
      const rows = parseCSV(text);
      if (!rows || rows.length < 2) continue;
      const headers = rows[0].map(h => h.trim().toLowerCase());
      const idx = {
        date:          headers.indexOf('date'),
        description:   headers.indexOf('description'),
        amount:        headers.indexOf('amount'),
        account:       headers.indexOf('account'),
        accountOwner:  headers.indexOf('account owner'),
        notes:         headers.indexOf('notes'),
        categoryId:    headers.indexOf('category_id'),
        subcategoryId: headers.indexOf('subcategory_id'),
        tags:          headers.indexOf('tags'),
      };
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rawAmt = (r[idx.amount] || '0').replace(/[$,]/g, '');
        const amount = parseFloat(rawAmt);
        if (!r[idx.date] || isNaN(amount) || amount === 0) continue;
        const parts = (r[idx.date] || '').split('/');
        const dateObj = parts.length === 3
          ? new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`)
          : new Date(r[idx.date]);
        const year = dateObj && !isNaN(dateObj) ? dateObj.getFullYear() : null;

        const rawCatId = idx.categoryId    >= 0 ? (r[idx.categoryId]    || '').trim() : '';
        const rawSubId = idx.subcategoryId >= 0 ? (r[idx.subcategoryId] || '').trim() : '';
        const rawTags  = idx.tags          >= 0 ? (r[idx.tags]          || '').trim() : '';
        // No categoryMap in demo mode — raw id is used as display name directly
        const category    = (rawCatId && categoryMap[rawCatId])
          ? categoryMap[rawCatId] : (rawCatId || 'Uncategorized');
        const subcategory = (rawCatId && rawSubId && subcategoryMap[`${rawCatId}::${rawSubId}`])
          ? subcategoryMap[`${rawCatId}::${rawSubId}`] : (rawSubId || '');
        const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

        combined.push({
          date:          r[idx.date] || '',
          dateObj,
          year,
          monthNum:      dateObj && !isNaN(dateObj) ? dateObj.getMonth() + 1 : null,
          description:   idx.description  >= 0 ? (r[idx.description]  || '') : '',
          amount,
          account:       idx.account      >= 0 ? (r[idx.account]      || '') : '',
          accountOwner:  idx.accountOwner >= 0 ? (r[idx.accountOwner] || '') : '',
          notes:         idx.notes        >= 0 ? (r[idx.notes]        || '') : '',
          categoryId:    rawCatId,
          category,
          subcategoryId: rawSubId,
          subcategory,
          tags,
        });
      }
    } catch (e) {
      console.warn('Could not load public gid', gid, e);
    }
  }
  allData = combined.sort((a,b) => (b.dateObj || 0) - (a.dateObj || 0));
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  populateFilters();
  applyFiltersAndRender();
  wireAppButtons();
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderKPIs() {
  const incomeRows  = filteredData.filter(r => (categoryTypes[r.category] || 'Expense') === 'Income');
  const expenseRows = filteredData.filter(r => (categoryTypes[r.category] || 'Expense') === 'Expense');

  const totalIncome  = incomeRows.reduce((s,r)  => s + r.amount, 0);
  const totalExpense = expenseRows.reduce((s,r) => s + r.amount, 0);
  const net = totalIncome + totalExpense; // expenses are typically negative, so this is income - |expenses|

  document.getElementById('kpi-income').textContent      = fmt(totalIncome);
  document.getElementById('kpi-income-sub').textContent  = `${incomeRows.length} transactions`;
  document.getElementById('kpi-expenses').textContent    = fmt(-totalExpense);
  document.getElementById('kpi-expenses-sub').textContent= `${expenseRows.length} transactions`;

  const netEl = document.getElementById('kpi-net');
  netEl.textContent = fmt(net);
  netEl.className = 'kpi-value ' + (net >= 0 ? 'kpi-positive' : 'kpi-negative');
  document.getElementById('kpi-net-sub').textContent = net >= 0 ? 'Surplus' : 'Deficit';

  const monthKeys  = [...new Set(expenseRows.filter(r => r.monthNum).map(r => `${r.year}-${r.monthNum}`))];
  const avgExpense = monthKeys.length ? totalExpense / monthKeys.length : totalExpense;
  document.getElementById('kpi-avg-month').textContent = fmt(-avgExpense);
  document.getElementById('kpi-avg-sub').textContent   = `over ${monthKeys.length} month${monthKeys.length !== 1 ? 's' : ''}`;

  // Top expense category is "largest negative" number
  const catGroups = groupBy(expenseRows, r => r.category);
  const topCat    = Object.entries(catGroups).sort((a,b) => sumArr(a[1]) - sumArr(b[1]))[0];
  if (topCat) {
    document.getElementById('kpi-top-cat').textContent     = topCat[0];
    document.getElementById('kpi-top-cat-sub').textContent = fmt(-sumArr(topCat[1]));
  }

  document.getElementById('kpi-txns').textContent     = filteredData.length.toLocaleString();
  document.getElementById('kpi-txns-sub').textContent  = `${incomeRows.length} income · ${expenseRows.length} expense`;
}

// ─── CHARTS ───────────────────────────────────────────────────────────────────
let chartFreq = 'monthly';
function getFreqKey(row) {
  if (!row.year || !row.monthNum) return null;
  if (chartFreq === 'daily') {
    if (!row.dateObj) return null;
    return `${row.year}-${String(row.monthNum).padStart(2,'0')}-${String(row.dateObj.getDate()).padStart(2,'0')}`;
  }
  if (chartFreq === 'yearly')   return String(row.year);
  if (chartFreq === 'quarterly') return `${row.year}-Q${Math.ceil(row.monthNum / 3)}`;
  return `${row.year}-${String(row.monthNum).padStart(2, '0')}`;
}

function freqKeyLabel(key) {
  if (chartFreq === 'yearly')    return key;
  if (chartFreq === 'quarterly') return key.replace('-', ' ');  // "2024 Q2"
  if (chartFreq === 'daily') {
    const [y, m, d] = key.split('-');
    return `${MONTHS[parseInt(m) - 1]} ${parseInt(d)} '${y.slice(2)}`; // e.g. "Jan 3 '24"
  }
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m) - 1]} ${y.slice(2)}`;           // "Jan 24"
}

const CHART_TITLES = {
  daily:     { trend: 'Daily Net Trend',       exptrend: 'Daily Expense Trend',       inctrend: 'Daily Income Trend',       catmonth: 'Day-over-Day Expenses'         },
  monthly:   { trend: 'Monthly Net Trend',     exptrend: 'Monthly Expense Trend',     inctrend: 'Monthly Income Trend',     catmonth: 'Month-over-Month Expenses'     },
  quarterly: { trend: 'Quarterly Net Trend',   exptrend: 'Quarterly Expense Trend',   inctrend: 'Quarterly Income Trend',   catmonth: 'Quarter-over-Quarter Expenses' },
  yearly:    { trend: 'Yearly Net Trend',      exptrend: 'Yearly Expense Trend',      inctrend: 'Yearly Income Trend',      catmonth: 'Year-over-Year Expenses'       },
};

function updateChartTitles() {
  const t = CHART_TITLES[chartFreq];
  document.getElementById('title-trend').textContent    = t.trend;
  document.getElementById('title-exptrend').textContent = t.exptrend;
  document.getElementById('title-income-trend').textContent = t.inctrend;
  document.getElementById('title-category-period').textContent = t.catmonth;
}

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function renderCharts() {
  renderNetTrendChart();
  renderExpenseTrendChart();
  renderIncomeTrendChart();
  renderCategoryDonut();
  renderCategoryBar();
  renderCategoryMonthChart();
}

function renderNetTrendChart() {
  destroyChart('trend');
  const keys = [...new Set(filteredData.filter(r => r.monthNum).map(r => getFreqKey(r)).filter(Boolean))].sort();
  const labels = keys.map(freqKeyLabel);
  const netData = keys.map(k => {
    const inc = sumArr(filteredData.filter(r => getFreqKey(r) === k && categoryTypes[r.category] !== 'Expense'));
    const exp = sumArr(filteredData.filter(r => getFreqKey(r) === k && categoryTypes[r.category] === 'Expense'));
    return inc + exp;
  });

  const netFillPlugin = {
    id: 'netFill',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales: { y } } = chart;
      if (!chartArea || !y) return;
      const pts = chart.getDatasetMeta(0).data;
      if (!pts.length) return;

      const zeroY = Math.max(chartArea.top, Math.min(chartArea.bottom, y.getPixelForValue(0)));

      // Trace the fill shape: follow points then close back along the zero baseline
      const tracePath = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          if (prev.cp2x !== undefined && curr.cp1x !== undefined) {
            // Follow the same bezier curve Chart.js drew
            ctx.bezierCurveTo(prev.cp2x, prev.cp2y, curr.cp1x, curr.cp1y, curr.x, curr.y);
          } else {
            ctx.lineTo(curr.x, curr.y);
          }
        }
        // Close back along the zero baseline
        ctx.lineTo(pts[pts.length - 1].x, zeroY);
        ctx.lineTo(pts[0].x, zeroY);
        ctx.closePath();
      };

      ctx.save();

      // Green fill — clip to region ABOVE the zero line
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, zeroY - chartArea.top);
      ctx.clip();
      tracePath();
      ctx.fillStyle = 'rgba(76,175,145,0.22)';
      ctx.fill();
      ctx.restore();

      // Red fill — clip to region BELOW the zero line
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, zeroY, chartArea.right - chartArea.left, chartArea.bottom - zeroY);
      ctx.clip();
      tracePath();
      ctx.fillStyle = 'rgba(224,92,92,0.22)';
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }
  };

  const lineColor = getChartThemeColors().tick; // muted gray — theme-aware, works light + dark

  charts['trend'] = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net',
        data: netData,
        fill: false,
        borderColor: lineColor,
        backgroundColor: 'transparent',
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: ctx => (ctx.parsed?.y ?? 0) >= 0 ? 'rgba(76,175,145,0.9)' : 'rgba(224,92,92,0.9)',
        pointBorderColor:     ctx => (ctx.parsed?.y ?? 0) >= 0 ? 'rgba(76,175,145,1.0)' : 'rgba(224,92,92,1.0)',
      }]
    },
    options: {
      ...baseOpts(),
      scales: {
        x: { ...axisStyle(), ticks: tickStyle() },
        y: { ...axisStyle(), ticks: { ...tickStyle(), callback: v => v.toLocaleString() } }
      }
    },
    plugins: [netFillPlugin]
  });
}

function renderExpenseTrendChart() {
  destroyChart('exptrend');
  const rows = filteredData.filter(r => categoryTypes[r.category] === 'Expense' && r.monthNum);
  const keys = [...new Set(rows.map(r => getFreqKey(r)).filter(Boolean))].sort();
  const labels = keys.map(freqKeyLabel);
  const values = keys.map(k => -sumArr(rows.filter(r => getFreqKey(r) === k)));
  charts['exptrend'] = new Chart(document.getElementById('chart-expense-trend'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Expenses', data: values, borderColor: '#e05c5c', backgroundColor: '#e05c5c22', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#e05c5c' }] },
    options: { ...baseOpts(), scales: { x: { ...axisStyle(), ticks: tickStyle() }, y: { ...axisStyle(), ticks: { ...tickStyle(), callback: v => v.toLocaleString() } } } }
  });
}

function renderIncomeTrendChart() {
  destroyChart('inctrend');
  const rows = filteredData.filter(r => categoryTypes[r.category] !== 'Expense' && r.monthNum);
  const keys = [...new Set(rows.map(r => getFreqKey(r)).filter(Boolean))].sort();
  const labels = keys.map(freqKeyLabel);
  const values = keys.map(k => sumArr(rows.filter(r => getFreqKey(r) === k)));
  charts['inctrend'] = new Chart(document.getElementById('chart-income-trend'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Income', data: values, borderColor: '#4caf91', backgroundColor: '#4caf9122', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#4caf91' }] },
    options: { ...baseOpts(), scales: { x: { ...axisStyle(), ticks: tickStyle() }, y: { ...axisStyle(), ticks: { ...tickStyle(), callback: v => v.toLocaleString() } } } }
  });
}

function renderCategoryMonthChart() {
  destroyChart('catmonth');
  const rows = filteredData.filter(r => categoryTypes[r.category] === 'Expense' && r.monthNum);
  const topCats = Object.entries(groupBy(rows, r => r.category))
    .sort((a, b) => sumArr(a[1]) - sumArr(b[1])).map(e => e[0]);
  const keys = [...new Set(rows.map(r => getFreqKey(r)).filter(Boolean))].sort();
  const labels = keys.map(freqKeyLabel);
  const datasets = topCats.map((cat, i) => ({
    label: cat,
    data: keys.map(k => -sumArr(rows.filter(r => r.category === cat && getFreqKey(r) === k))),
    backgroundColor: PALETTE[i % PALETTE.length] + 'cc', borderRadius: 4,
  }));
  charts['catmonth'] = new Chart(document.getElementById('chart-category-period'), {
    type: 'bar',
    data: { labels, datasets },
    options: { ...baseOpts(), scales: { x: { stacked: true, ...axisStyle(), ticks: tickStyle() }, y: { stacked: true, ...axisStyle(), ticks: { ...tickStyle(), callback: v => v.toLocaleString() } } } }
  });
}

function renderCategoryDonut() {
  destroyChart('donut');
  const rows   = filteredData.filter(r => (categoryTypes[r.category] || 'Expense') === 'Expense');
  const sorted = Object.entries(groupBy(rows, r => r.category))
    .map(([cat, recs]) => [cat, -sumArr(recs)]).sort((a, b) => a[1] - b[1]);
  const palette = sorted.map((_, i) => PALETTE[i % PALETTE.length]);
  charts['donut'] = new Chart(document.getElementById('chart-category-donut'), {
    type: 'doughnut',
    data: { labels: sorted.map(e => e[0]), datasets: [{ data: sorted.map(e => e[1]), backgroundColor: palette, borderWidth: 0 }] },
    options: { ...baseOpts(), layout: { padding: 8 },
      onClick: (event, elements) => {
        if (elements.length > 0) renderSubcategoryDrill(sorted[elements[0].index][0]);
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: { ...baseOpts().plugins,
        legend: { position: 'bottom', labels: { color: getChartThemeColors().legend, font: { size: 11 }, boxWidth: 12, padding: 10,
          generateLabels: chart => chart.data.labels.map((lbl, i) => ({
            text: lbl.length > 24 ? lbl.slice(0, 23) + '…' : lbl,
            fillStyle: chart.data.datasets[0].backgroundColor[i], fontColor: getChartThemeColors().legend, hidden: false, index: i })) } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)}` } } } }
  });
}

function renderCategoryBar() {
  destroyChart('catbar');
  const rows   = filteredData.filter(r => (categoryTypes[r.category] || 'Expense') === 'Expense');
  const sorted = Object.entries(groupBy(rows, r => r.category))
    .map(([cat, recs]) => [cat, -sumArr(recs)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
  charts['catbar'] = new Chart(document.getElementById('chart-category-bar'), {
    type: 'bar',
    data: { labels: sorted.map(e => e[0]), datasets: [{ data: sorted.map(e => e[1]), backgroundColor: PALETTE, borderRadius: 6 }] },
    options: { ...baseOpts(), 
      onClick: (event, elements) => {
        if (elements.length > 0) renderSubcategoryDrill(sorted[elements[0].index][0]);
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: { ...baseOpts().plugins, legend: { display: false } },
      scales: { x: { ...axisStyle(), ticks: { ...tickStyle(), maxRotation: 35 } }, y: { ...axisStyle(), ticks: { ...tickStyle(), callback: v => '$' + v.toLocaleString() } } } }
  });
}

function renderSubcategoryDrill(categoryName, scrollToCard = true) {
  activeDrillCategory = categoryName;
  const card = document.getElementById('subcategory-drill-card');
  document.getElementById('drill-title').textContent = `${categoryName} — Subcategory Breakdown`;
  card.style.display = 'block';
  if (scrollToCard) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  destroyChart('subDrill');
  const rows    = filteredData.filter(r => r.category === categoryName);
  const grouped = Object.entries(groupBy(rows, r => r.subcategory || '(no subcategory)'))
    .map(([sub, recs]) => [sub, -sumArr(recs)])
    .sort((a, b) => b[1] - a[1]);

  charts['subDrill'] = new Chart(document.getElementById('chart-subcategory-drill'), {
    type: 'bar',
    data: {
      labels: grouped.map(e => e[0]),
      datasets: [{ data: grouped.map(e => e[1]), backgroundColor: PALETTE, borderRadius: 6 }]
    },
    options: {
      ...baseOpts(),
      plugins: { ...baseOpts().plugins, legend: { display: false } },
      scales: {
        x: { ...axisStyle(), ticks: { ...tickStyle(), maxRotation: 35 } },
        y: { ...axisStyle(), ticks: { ...tickStyle(), callback: v => '$' + v.toLocaleString() } }
      }
    }
  });
}

function getChartThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const g = k => s.getPropertyValue(k).trim();
  return {
    grid:          g('--chart-grid')           || 'rgba(0,0,0,0.07)',
    border:        g('--chart-border')         || 'rgba(0,0,0,0.09)',
    tick:          g('--chart-tick')           || '#7a7974',
    tooltipBg:     g('--chart-tooltip-bg')     || '#f9f8f5',
    tooltipTitle:  g('--chart-tooltip-title')  || '#28251d',
    tooltipBody:   g('--chart-tooltip-body')   || '#7a7974',
    tooltipBorder: g('--chart-tooltip-border') || '#dcd9d5',
    legend:        g('--chart-legend')         || '#7a7974',
  };
}

function baseOpts() {
  const c = getChartThemeColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.tooltipBg,
        titleColor: c.tooltipTitle,
        bodyColor: c.tooltipBody,
        borderColor: c.tooltipBorder,
        borderWidth: 1
      }
    }
  };
}

function axisStyle() {
  const c = getChartThemeColors();
  return { grid: { color: c.grid }, border: { color: c.border } };
}

function tickStyle() {
  const c = getChartThemeColors();
  return { color: c.tick, font: { size: 11 } };
}

// ─── RE-RENDER CHARTS ON THEME CHANGE ───────────────────────────────────────
new MutationObserver(() => {
  if (Object.keys(charts).length > 0) renderCharts();
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme']
});

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderTable() {
  
  const q = document.getElementById('search-input').value.toLowerCase();
  const tableData = q
    ? filteredData.filter(r => [r.description, r.category, r.subcategory, r.notes, ...(r.tags || [])].some(s => s && s.toLowerCase().includes(q)))
    : filteredData
  
  let data = [...tableData].sort((a, b) => {
    let av = sortCol === 'date' ? (a.dateObj || 0) : sortCol === 'amount' ? a.amount : (a[sortCol] || '');
    let bv = sortCol === 'date' ? (b.dateObj || 0) : sortCol === 'amount' ? b.amount : (b[sortCol] || '');
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const total = data.length;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = data.slice(start, start + PAGE_SIZE);
  document.getElementById('txn-tbody').innerHTML = page.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${esc(r.description)}</td>
      <td class="amount-cell ${r.amount >= 0 ? 'is-positive' : 'is-negative'}">${fmt(r.amount)}</td>
      <td><span class="category-badge">${esc(r.category)}</span></td>
      <td style="color:var(--muted);font-size:0.82rem">${esc(r.subcategory)}</td>
      <td>${(r.tags||[]).map(t => `<span class="tag-badge">${esc(t)}</span>`).join('')}</td>
      <td>${esc(r.account)}</td>
      <td>${esc(r.accountOwner)}</td>
      <td style="color:var(--muted);font-size:0.8rem">${esc(r.notes)}</td>
    </tr>`).join('');

  document.getElementById('page-info').textContent = total
    ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : 'No results';
  document.getElementById('prev-btn').disabled = currentPage === 1;
  document.getElementById('next-btn').disabled = start + PAGE_SIZE >= total;
}

document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    sortDir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    sortCol = col;
    renderTable();
  });
});

document.getElementById('prev-btn').addEventListener('click', () => { currentPage--; renderTable(); });
document.getElementById('next-btn').addEventListener('click', () => { currentPage++; renderTable(); });

document.getElementById('search-input').addEventListener('input', () => {
  currentPage = 1;
  renderTable();
});

// ─── UTILS ────────────────────────────────────────────────────────────────────
function groupBy(arr, fn) {
  return arr.reduce((acc, r) => { const k = fn(r); (acc[k] = acc[k] || []).push(r); return acc; }, {});
}
function sumArr(arr) {
  return arr.reduce((s, r) => s + (typeof r === 'object' ? r.amount : r), 0);
}
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showToast(msg, durationMs = 2800) {
  // Remove any existing toast first
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.id = 'app-toast';
  el.textContent = msg;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-hiding');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, durationMs);
}

// ─── CATEGORY TYPE MAPPING ────────────────────────────────────────────────────
// categoryTypes: { [categoryName]: 'Income' | 'Expense' }
// Default: any category whose name contains "income" (case-insensitive) → Income, else → Expense
let categoryTypes = {};

function buildCategoryTypeDefaults(cats) {
  cats.forEach(cat => {
    if (!(cat in categoryTypes)) {
      categoryTypes[cat] = /income/i.test(cat) ? 'Income' : 'Expense';
    }
  });
}

function renderCategoryTypeModal(cats) {
  const list = document.getElementById('cat-type-list');
  list.innerHTML = '';
  cats.forEach(cat => {
    const type = categoryTypes[cat] || 'Expense';
    const row  = document.createElement('div');
    row.className = 'cat-type-row';
    row.innerHTML =
      '<span class="cat-type-name">' + esc(cat) + '</span>' +
      '<div class="type-toggle">' +
        '<button class="type-btn ' + (type === 'Expense' ? 'active-expense' : '') + '" data-cat="' + esc(cat) + '" data-type="Expense">Expense</button>' +
        '<button class="type-btn ' + (type === 'Income'  ? 'active-income'  : '') + '" data-cat="' + esc(cat) + '" data-type="Income">Income</button>' +
      '</div>';
    row.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.cat, t = btn.dataset.type;
        categoryTypes[c] = t;
        // Update button states in this row
        row.querySelectorAll('.type-btn').forEach(b => {
          b.className = 'type-btn' +
            (b.dataset.type === 'Expense' && t === 'Expense' ? ' active-expense' : '') +
            (b.dataset.type === 'Income'  && t === 'Income'  ? ' active-income'  : '');
        });
        // live update everything now that category type changed
        renderKPIs();
        updateChartTitles();
        renderCharts();
      });
    });
    list.appendChild(row);
  });
}

// ─── UNIFIED MULTI-SELECT ENGINE ─────────────────────────────────────────────
const excluded = { year: new Set(), month: new Set(), owner: new Set(), cat: new Set() };
const MS_CONFIG = {
  year:  { label: 'All Years',      singular: 'Year'     },
  month: { label: 'All Months',     singular: 'Month'    },
  owner: { label: 'All Owners',     singular: 'Owner'    },
  cat:   { label: 'All Categories', singular: 'Category' },
  tag:   { label: 'All Tags',       singular: 'Tag'      },
};
const MS_KEYS = ['year', 'month', 'owner', 'cat', 'tag'];

function initAllMultiSelects() {
  MS_KEYS.forEach(key => {
    const trigger  = document.getElementById(key + '-trigger');
    const dropdown = document.getElementById(key + '-dropdown');
    const search   = document.getElementById(key + '-search');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = dropdown.classList.contains('open');
      closeAllDropdowns();
      if (!wasOpen) {
        dropdown.classList.add('open');
        trigger.classList.add('open');
        if (search) { search.value = ''; filterMSSearch(key); search.focus(); }
      }
    });
    if (search) search.addEventListener('input', () => filterMSSearch(key));
  });

  document.querySelectorAll('.ms-action-btn[data-ms]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.ms, action = btn.dataset.action;
      const cbs = document.querySelectorAll(`#${key}-options .ms-option input`);
      if (key === 'tag') {
        selectedTags.clear();
        if (action === 'all') cbs.forEach(cb => { cb.checked = true;  selectedTags.add(cb.value); });
        else                  cbs.forEach(cb => { cb.checked = false; });
      } else {
        if (action === 'all') { excluded[key].clear(); cbs.forEach(cb => cb.checked = true); }
        else { cbs.forEach(cb => { cb.checked = false; excluded[key].add(cb.value); }); }
      }
      updateMSTrigger(key);
      applyFiltersAndRender();
      closeAllDropdowns();
    });
  });

  document.querySelectorAll('.ms-tag-mode-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      tagFilterMode = btn.dataset.mode;
      document.querySelectorAll('.ms-tag-mode-btn').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      updateMSTrigger('tag');
      applyFiltersAndRender();
    });
  });

  document.addEventListener('click', () => closeAllDropdowns());
}

function closeAllDropdowns() {
  MS_KEYS.forEach(k => {
    document.getElementById(k + '-dropdown').classList.remove('open');
    document.getElementById(k + '-trigger').classList.remove('open');
  });
}

function filterMSSearch(key) {
  const s = document.getElementById(key + '-search');
  if (!s) return;
  const q = s.value.toLowerCase();
  document.querySelectorAll('#' + key + '-options .ms-option').forEach(opt => {
    opt.style.display = opt.dataset.label.toLowerCase().includes(q) ? '' : 'none';
  });
}

function populateMSOptions(key, items) {
  const container = document.getElementById(`${key}-options`);
  container.innerHTML = '';
  if (key === 'tag') selectedTags.clear();
  else excluded[key]?.clear();

  items.forEach(({ value, label }) => {
    const div = document.createElement('div');
    div.className = 'ms-option';
    div.dataset.label = label;
    const safeId  = `${key}_${value.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const safeVal = value.replace(/"/g, '&quot;');
    const safeLbl = label.replace(/</g, '&lt;');

    const checked = key === 'tag' ? '' : 'checked';
    div.innerHTML = `<input type="checkbox" id="${safeId}" value="${safeVal}" ${checked}> <label for="${safeId}">${safeLbl}</label>`;
    div.addEventListener('click', e => e.stopPropagation());
    div.querySelector('input').addEventListener('change', e => {
      if (key === 'tag') {
        if (e.target.checked) selectedTags.add(value);
        else selectedTags.delete(value);
      } else {
        if (e.target.checked) excluded[key].delete(value);
        else excluded[key].add(value);
      }
      updateMSTrigger(key);
      applyFiltersAndRender();
    });
    container.appendChild(div);
  });
  updateMSTrigger(key);
}

function updateMSTrigger(key) {
  const trigger = document.getElementById(`${key}-trigger`);
  const cfg = MS_CONFIG[key];

  if (key === 'tag') {
    if (selectedTags.size === 0) {
      trigger.textContent = cfg.label;
    } else {
      trigger.innerHTML = `${cfg.singular}s <span class="ms-badge">${tagFilterMode} · ${selectedTags.size}</span>`;
    }
    return;
  }

  const total   = document.querySelectorAll(`#${key}-options .ms-option input`).length;
  const checked = document.querySelectorAll(`#${key}-options .ms-option input:checked`).length;
  if (total === 0 || checked === total) trigger.textContent = cfg.label;
  else if (checked === 0) trigger.textContent = `No ${cfg.singular}s`;
  else trigger.innerHTML = `${cfg.singular}s <span class="ms-badge">${checked}/${total}</span>`;
}
