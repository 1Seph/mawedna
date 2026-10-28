(() => {
  'use strict';
  const { ICONS, CATEGORIES, SEED_TASKS, PHASES, QUOTES } = window.MAWEDNA_DATA;
  const STORE_KEY = 'mawedna:v1';
  const DAY = 864e5;

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const cat = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const parseDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const diffDays = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);

  const loc = (cal = 'gregory') => `ar-SA-u-ca-${cal}-nu-${state && state.prefs.digits === 'arab' ? 'arab' : 'latn'}`;
  const num = (n, o) => new Intl.NumberFormat(loc(), o).format(n);
  const money = n => `${num(Math.round(n))}<span class="cur"> ر.س</span>`;
  const moneyText = n => `${num(Math.round(n))} ر.س`;
  const asDate = d => (typeof d === 'string' ? parseDate(d) : d);
  const fmtDate = (d, o = { day: 'numeric', month: 'long', year: 'numeric' }) => new Intl.DateTimeFormat(loc(), o).format(asDate(d));
  const fmtHijri = d => new Intl.DateTimeFormat(loc('islamic-umalqura'), { day: 'numeric', month: 'long', year: 'numeric' }).format(asDate(d));
  const fmtTime = t => { const [h, m] = (t || '20:00').split(':').map(Number); const d = new Date(); d.setHours(h, m); return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit' }).format(d); };

  // Arabic counted nouns. "two" uses the oblique form since most phrases read "بعد يومين / خلال يومين".
  const PR = new Intl.PluralRules('ar');
  const U = {
    day: { one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يومًا', other: 'يوم' },
    dayNom: { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', other: 'يوم' },
    task: { one: 'مهمة واحدة', two: 'مهمتين', few: 'مهام', many: 'مهمة', other: 'مهمة' },
  };
  const count = (n, f) => { n = Math.abs(n); if (n === 1) return f.one; if (n === 2) return f.two; return `${num(n)} ${f[PR.select(n)] || f.other}`; };
  // Adjective agreement makes "N overdue tasks" irregular enough to spell out.
  const overdueText = n => n === 1 ? 'مهمة متأخرة' : n === 2 ? 'مهمتان متأخرتان' : `${num(n)} ${PR.select(n) === 'few' ? 'مهام متأخرة' : 'مهمة متأخرة'}`;
  // Unit word alone, for layouts that show the number large and the noun beside it.
  const dayUnit = n => { n = Math.abs(n); return n === 1 ? 'يوم' : n === 2 ? 'يومان' : U.dayNom[PR.select(n)] || 'يوم'; };

  /* ---------- state ---------- */
  let state = load();
  const ui = { route: 'home', status: 'open', cat: 'all', query: '', openPhases: new Set(), quoteShift: 0, doneOpen: false };
  let tickTimer = null;
  let confirmCb = null;

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { /* fall through to onboarding */ }
    return null;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: keep in memory */ } }
  function migrate(s) {
    s.prefs = Object.assign({ digits: 'latn', hijri: true }, s.prefs);
    s.reminders = Object.assign(defaultReminders(), s.reminders);
    s.expenses = s.expenses || [];
    s.tasks = s.tasks || [];
    return s;
  }
  function defaultReminders() { return { enabled: true, motivation: true, tasks: true, daysBefore: 3, time: '09:00', weekly: true, budget: true, budgetThreshold: 90 }; }

  // Split a total across categories by their default share, rounded to 500, with the rounding remainder in "other".
  function distribute(total) {
    const alloc = Object.fromEntries(CATEGORIES.map(c => [c.id, Math.round(total * c.share / 500) * 500]));
    alloc.other += total - sum(Object.values(alloc), v => v);
    return alloc;
  }

  function createState(f, demo = false) {
    const wd = parseDate(f.weddingDate);
    const left = diffDays(today(), wd);
    // Squeeze the template into the time that's actually left, so a short engagement doesn't start out overdue.
    const scale = demo ? 1 : clamp((left - 1) / 365, 0.02, 1);
    const tasks = SEED_TASKS.map(s => ({
      id: uid(), key: s.key, title: s.title, category: s.cat, priority: s.pri,
      dueDate: toISO(addDays(wd, -Math.round(s.offset * scale))), done: false, doneAt: null, note: '',
    }));
    const total = Number(f.budget) || 0;
    return {
      version: 1,
      createdAt: toISO(today()),
      profile: {
        partner1: f.partner1.trim(), partner2: f.partner2.trim(),
        weddingDate: f.weddingDate, weddingTime: f.weddingTime || '20:00',
        engagementDate: f.engagementDate || '', engagementLabel: 'الملكة',
        city: f.city || '', venue: f.venue || '',
      },
      budget: { total, alloc: distribute(total) },
      tasks, expenses: [],
      reminders: defaultReminders(),
      prefs: { digits: 'latn', hijri: true },
    };
  }

  function createDemo() {
    const t = today();
    const s = createState({
      partner1: 'سارة', partner2: 'عبدالله', weddingDate: toISO(addDays(t, 158)), weddingTime: '20:30',
      engagementDate: toISO(addDays(t, 37)), city: 'الرياض', venue: 'قاعة الياسمين', budget: 180000,
    }, true);
    s.createdAt = toISO(addDays(t, -205));
    const earlyDone = { 'card-design': 9, 'honeymoon-book': 16, 'medical': 4 };
    s.tasks.forEach(task => {
      const due = parseDate(task.dueDate);
      if (task.key === 'beauty' || task.key === 'mahr') return; // leave a couple overdue for a realistic picture
      if (due < t) { task.done = true; task.doneAt = toISO(addDays(due, -((task.title.length % 5)))); }
      if (earlyDone[task.key]) { task.done = true; task.doneAt = toISO(addDays(t, -earlyDone[task.key])); }
    });
    const e = (title, amount, category, daysAgo, status) => ({ id: uid(), title, amount, category, date: toISO(addDays(t, -daysAgo)), status, note: '' });
    s.expenses = [
      e('عربون قاعة الزفاف', 20000, 'venue', 190, 'deposit'),
      e('الدفعة الثانية للقاعة', 34000, 'venue', -60, 'due'),
      e('عربون منسّقة الكوشة', 6000, 'venue', 120, 'deposit'),
      e('فستان الزفاف', 14500, 'fashion', 70, 'paid'),
      e('الشبكة', 9800, 'fashion', 40, 'paid'),
      e('عربون المصوّرة', 3500, 'photo', 150, 'deposit'),
      e('بطاقات الدعوة', 2200, 'invitations', 9, 'paid'),
      e('الفحص الطبي', 600, 'legal', 4, 'paid'),
      e('تذاكر شهر العسل', 7400, 'honeymoon', 16, 'paid'),
      e('أثاث غرفة النوم', 11000, 'home', 25, 'paid'),
      e('فرقة الحفل', 8000, 'celebration', -100, 'due'),
    ];
    return s;
  }

  /* ---------- derived data ---------- */
  const weddingAt = () => { const d = parseDate(state.profile.weddingDate); const [h, m] = (state.profile.weddingTime || '20:00').split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
  const daysLeft = () => diffDays(today(), parseDate(state.profile.weddingDate));
  const isOverdue = t => !t.done && t.dueDate && parseDate(t.dueDate) < today();
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

  function taskStats(list = state.tasks) {
    const total = list.length, done = list.filter(t => t.done).length;
    return { total, done, left: total - done, overdue: list.filter(isOverdue).length, pct: total ? Math.round(done / total * 100) : 0 };
  }

  function budgetStats() {
    const total = state.budget.total;
    const paid = sum(state.expenses.filter(x => x.status !== 'due'), x => x.amount);
    const due = sum(state.expenses.filter(x => x.status === 'due'), x => x.amount);
    const cats = CATEGORIES.map(c => {
      const ex = state.expenses.filter(x => x.category === c.id);
      const cPaid = sum(ex.filter(x => x.status !== 'due'), x => x.amount);
      const cDue = sum(ex.filter(x => x.status === 'due'), x => x.amount);
      const alloc = state.budget.alloc[c.id] || 0;
      return { ...c, alloc, paid: cPaid, due: cDue, committed: cPaid + cDue, count: ex.length, over: cPaid + cDue > alloc };
    });
    return { total, paid, due, committed: paid + due, remaining: total - paid - due, allocated: sum(cats, c => c.alloc), pct: total ? Math.round((paid + due) / total * 100) : 0, cats };
  }

  const phaseOfTask = t => { const d = diffDays(parseDate(t.dueDate), parseDate(state.profile.weddingDate)); return PHASES.find(p => d <= p.from && d > p.to) || PHASES[PHASES.length - 1]; };
  const currentPhase = () => { const d = daysLeft(); return PHASES.find(p => d <= p.from && d > p.to) || PHASES[PHASES.length - 1]; };

  // On track when overdue work is small and completion keeps up with the time that has passed.
  function pace() {
    const st = taskStats();
    const start = parseDate(state.createdAt), end = parseDate(state.profile.weddingDate);
    const span = Math.max(1, diffDays(start, end));
    const elapsed = clamp(diffDays(start, today()) / span * 100, 0, 100);
    const expected = state.tasks.filter(t => t.dueDate && parseDate(t.dueDate) <= today()).length;
    const doneExpected = state.tasks.filter(t => t.done && t.dueDate && parseDate(t.dueDate) <= today()).length;
    const ratio = expected ? doneExpected / expected : 1;
    let level = 'good';
    if (st.overdue >= 4 || ratio < 0.6) level = 'behind';
    else if (st.overdue > 0) level = 'close';
    return { level, elapsed: Math.round(elapsed), ratio };
  }

  function achievements() {
    const st = taskStats(), b = budgetStats(), dl = daysLeft();
    const doneKey = k => state.tasks.some(t => t.key === k && t.done);
    return [
      { id: 'first', title: 'البداية الجميلة', desc: 'أول مهمة مكتملة', icon: 'sparkle', got: st.done >= 1 },
      { id: 'venue', title: 'القاعة محجوزة', desc: 'حُجزت قاعة الزفاف', icon: 'venue', got: doneKey('venue-book') },
      { id: 'q1', title: 'ربع الطريق', desc: `إنجاز ${num(25)}٪ من المهام`, icon: 'flag', got: st.pct >= 25 },
      { id: 'q2', title: 'منتصف الطريق', desc: `إنجاز ${num(50)}٪ من المهام`, icon: 'target', got: st.pct >= 50 },
      { id: 'q3', title: 'على مقربة', desc: `إنجاز ${num(75)}٪ من المهام`, icon: 'award', got: st.pct >= 75 },
      { id: 'budget', title: 'ميزانية مطمئنة', desc: 'كل البنود ضمن المخصص', icon: 'wallet', got: state.expenses.length >= 3 && b.cats.every(c => !c.over) },
      { id: 'hundred', title: 'العدّ بالأيام', desc: `أقل من ${num(100)} يوم على الزفاف`, icon: 'clock', got: dl <= 100 },
      { id: 'all', title: 'كل شيء جاهز', desc: 'اكتملت جميع المهام', icon: 'heart', got: st.total > 0 && st.done === st.total },
    ];
  }

  function reminders() {
    const r = state.reminders, out = [];
    if (!r.enabled) return out;
    const t = today();
    if (r.tasks) {
      state.tasks.filter(isOverdue).sort(byDue).forEach(x => out.push({ kind: 'overdue', icon: 'alert', title: x.title, sub: `متأخرة ${count(diffDays(parseDate(x.dueDate), t), U.day)}`, id: x.id }));
      state.tasks.filter(x => !x.done && x.dueDate && !isOverdue(x) && diffDays(t, parseDate(x.dueDate)) <= r.daysBefore).sort(byDue)
        .forEach(x => out.push({ kind: 'soon', icon: 'clock', title: x.title, sub: relDue(x), id: x.id }));
    }
    if (r.budget) {
      budgetStats().cats.forEach(c => {
        if (c.alloc > 0 && c.committed / c.alloc * 100 >= r.budgetThreshold) out.push({ kind: 'budget', icon: 'wallet', title: `بند ${c.name}`, sub: c.committed > c.alloc ? `تجاوز المخصص بـ ${moneyText(c.committed - c.alloc)}` : `استُهلك ${num(Math.round(c.committed / c.alloc * 100))}٪ من المخصص`, cat: c.id });
      });
      state.expenses.filter(x => x.status === 'due' && diffDays(t, parseDate(x.date)) <= 30).forEach(x =>
        out.push({ kind: 'payment', icon: 'calendar', title: `دفعة مستحقة: ${x.title}`, sub: `${moneyText(x.amount)} · ${fmtDate(x.date, { day: 'numeric', month: 'long' })}`, expense: x.id }));
    }
    return out;
  }

  function relDue(t) {
    if (!t.dueDate) return 'بدون موعد';
    const d = diffDays(today(), parseDate(t.dueDate));
    if (t.done) return 'مكتملة';
    if (d === 0) return 'اليوم';
    if (d === 1) return 'غدًا';
    if (d === -1) return 'متأخرة منذ أمس';
    if (d < 0) return `متأخرة ${count(d, U.day)}`;
    if (d <= 14) return `بعد ${count(d, U.day)}`;
    return fmtDate(t.dueDate, { day: 'numeric', month: 'long' });
  }

  function greeting() { const h = new Date().getHours(); return h < 12 ? 'صباح الخير' : 'مساء الخير'; }

  function quoteOfDay() {
    const t = today(); const start = new Date(t.getFullYear(), 0, 0);
    const i = (diffDays(start, t) + ui.quoteShift) % QUOTES.length;
    return QUOTES[(i + QUOTES.length) % QUOTES.length];
  }

  function contextualNote() {
    const dl = daysLeft(), st = taskStats();
    if (dl < 0) return 'ألف مبروك! نتمنى لكما حياة مليئة بالمودة والسكينة.';
    if (dl === 0) return 'بارك الله لكما وبارك عليكما وجمع بينكما في خير.';
    if (st.overdue > 0) return `لديكما ${overdueText(st.overdue)}، ابدآ بأسهلها لتستعيدا الإيقاع.`;
    if (dl <= 7) return 'الأسبوع الأخير: الأهم الآن أن ترتاحا وتستمتعا.';
    if (dl <= 30) return 'الشهر الأخير. ركّزا على التأكيدات واتركا التفاصيل الصغيرة تمضي.';
    if (st.pct >= 50) return 'أنجزتما أكثر من نصف الطريق، أداء رائع!';
    return 'الوقت في صالحكما، والبداية المبكرة تصنع فرقًا.';
  }

  /* ---------- small UI pieces ---------- */
  function ring(p, size = 92, sw = 7, color = 'var(--gold)', track = 'var(--ring-track)') {
    const r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - clamp(p, 0, 100) / 100), h = size / 2;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
      <circle class="ring-val" cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${h} ${h})"/></svg>`;
  }

  function donut(segments, size = 168, sw = 18) {
    const r = (size - sw) / 2, c = 2 * Math.PI * r, h = size / 2;
    const total = sum(segments, s => s.value) || 1;
    let acc = 0;
    const gap = segments.filter(s => s.value > 0).length > 1 ? 2 : 0;
    const arcs = segments.filter(s => s.value > 0).map(s => {
      const len = Math.max(0, s.value / total * c - gap);
      const el = `<circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${h} ${h})"><title>${esc(s.label)}</title></circle>`;
      acc += s.value / total * c;
      return el;
    }).join('');
    return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="توزيع المصروفات"><circle cx="${h}" cy="${h}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${sw}"/>${arcs}</svg>`;
  }

  const bar = (pct, color = 'var(--green)', extra = '') => `<div class="bar ${extra}"><span style="width:${clamp(pct, 0, 100)}%;background:${color}"></span></div>`;
  const catBadge = (id, small = false) => { const c = cat(id); return `<span class="cat-dot ${small ? 'sm' : ''}" style="--c:${c.color}">${icon(c.icon)}</span>`; };
  const empty = (ic, title, sub) => `<div class="empty">${icon(ic)}<p class="empty-t">${title}</p>${sub ? `<p class="empty-s">${sub}</p>` : ''}</div>`;

  function taskRow(t) {
    const c = cat(t.category), od = isOverdue(t);
    return `<li class="task ${t.done ? 'is-done' : ''} ${od ? 'is-overdue' : ''}" data-action="open-task" data-id="${t.id}">
      <button class="check" data-action="toggle-task" data-id="${t.id}" aria-pressed="${t.done}" aria-label="${t.done ? 'إلغاء الإكمال' : 'تحديد كمكتملة'}">${icon('check')}</button>
      <div class="task-body">
        <p class="task-title">${esc(t.title)}</p>
        <p class="task-meta"><span class="meta-cat" style="--c:${c.color}">${esc(c.name)}</span><span class="dot-sep"></span><span class="${od ? 'txt-warn' : ''}">${relDue(t)}</span>${t.priority === 'high' && !t.done ? '<span class="pri">مهم</span>' : ''}</p>
      </div>
      ${icon('chevL', 'task-chev')}
    </li>`;
  }

  /* ---------- shell ---------- */
  const NAV = [
    { id: 'home', label: 'الرئيسية', icon: 'home' },
    { id: 'tasks', label: 'المهام', icon: 'tasks' },
    { id: 'timeline', label: 'المراحل', icon: 'timeline' },
    { id: 'budget', label: 'الميزانية', icon: 'wallet' },
    { id: 'progress', label: 'التقدّم', icon: 'chart' },
  ];
  const TITLES = { home: 'الرئيسية', tasks: 'قائمة المهام', timeline: 'مراحل التحضير', budget: 'الميزانية', progress: 'التقدّم', settings: 'الإعدادات' };

  const logo = (size = 40) => `<span class="logo" style="width:${size}px;height:${size}px"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="16" cy="21" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="24" cy="21" r="8.5" fill="none" stroke="var(--gold)" stroke-width="1.6"/><path d="M20 7.5l1.3 2.7 2.7 1.3-2.7 1.3L20 15.5l-1.3-2.7-2.7-1.3 2.7-1.3z" fill="var(--gold)"/></svg></span>`;

  function renderShell() {
    $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">${logo(44)}<div><div class="brand-ar">موعدنا</div><div class="brand-en">Mawedna</div></div></div>
        <nav class="side-nav" aria-label="التنقل الرئيسي">
          ${NAV.map(n => `<a href="#/${n.id}" class="side-link" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>`).join('')}
          <div class="side-sep"></div>
          <a href="#/settings" class="side-link" data-nav="settings">${icon('settings')}<span>الإعدادات</span></a>
        </nav>
        <div class="side-card" id="side-card"></div>
      </aside>
      <div class="content">
        <header class="topbar">
          <a href="#/home" class="top-brand">${logo(34)}<span class="brand-ar">موعدنا</span></a>
          <h2 class="top-title" id="top-title"></h2>
          <div class="top-actions">
            <button class="icon-btn" data-action="open-alerts" aria-label="التنبيهات">${icon('bell')}<span class="badge" id="alert-badge" hidden></span></button>
            <a class="icon-btn mobile-only" href="#/settings" aria-label="الإعدادات">${icon('settings')}</a>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="التنقل">
        ${NAV.map(n => `<a href="#/${n.id}" class="tab" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>`).join('')}
      </nav>
    </div>`;
  }

  function updateChrome() {
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === ui.route));
    $('#top-title').textContent = TITLES[ui.route] || '';
    const n = reminders().length, badge = $('#alert-badge');
    badge.hidden = !n; badge.textContent = num(n);
    const dl = daysLeft();
    $('#side-card').innerHTML = `<p class="side-card-k">${dl > 0 ? 'متبقٍ على الزفاف' : dl === 0 ? 'اليوم' : 'مبارك'}</p>
      <p class="side-card-v">${dl > 0 ? count(dl, U.dayNom) : dl === 0 ? 'يوم الزفاف' : 'تمّ الزفاف'}</p>
      <p class="side-card-s">${fmtDate(state.profile.weddingDate)}</p>`;
  }

  /* ---------- views ---------- */
  function viewHome() {
    const p = state.profile, st = taskStats(), b = budgetStats(), ph = currentPhase(), dl = daysLeft();
    const upcoming = state.tasks.filter(t => !t.done).sort(byDue).slice(0, 4);
    const past = dl < 0;
    let eng = '';
    if (p.engagementDate) {
      const ed = diffDays(today(), parseDate(p.engagementDate));
      const label = esc(p.engagementLabel || 'الملكة');
      eng = `<article class="card mini eng" data-href="#/settings">
        <div class="mini-head"><span class="mini-ic blush">${icon('ring')}</span><span class="mini-k">${label}</span></div>
        <p class="mini-v">${ed === 0 ? 'اليوم' : num(Math.abs(ed))}${ed === 0 ? '' : `<small> ${dayUnit(ed)}</small>`}</p>
        <p class="mini-s">${ed > 0 ? `حتى ${label} · ${fmtDate(p.engagementDate, { day: 'numeric', month: 'long' })}` : ed === 0 ? 'مبارك، اليوم موعدكما' : `مضت على ${label}`}</p>
      </article>`;
    }
    return `
    <section class="greet fade">
      <p class="eyebrow">${greeting()}</p>
      <h1 class="couple">${esc(p.partner1)} <span class="amp">&</span> ${esc(p.partner2)}</h1>
    </section>

    <section class="hero fade">
      <div class="hero-orn" aria-hidden="true"></div>
      <p class="hero-k">${past ? 'مضى على زفافكما' : 'العدّ التنازلي ليوم الزفاف'}</p>
      <div class="countdown" role="timer" aria-live="off">
        ${[['d', 'يوم'], ['h', 'ساعة'], ['m', 'دقيقة'], ['s', 'ثانية']].map(([k, l]) => `<div class="cd"><span class="cd-n" data-cd="${k}">00</span><span class="cd-l">${l}</span></div>`).join('<span class="cd-sep">:</span>')}
      </div>
      <div class="hero-foot">
        <span>${icon('calendar')} ${fmtDate(p.weddingDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${state.prefs.hijri ? ` <span class="muted-light">· ${fmtHijri(p.weddingDate)}</span>` : ''}</span>
        ${p.venue || p.city ? `<span>${icon('pin')} ${esc([p.venue, p.city].filter(Boolean).join('، '))}</span>` : ''}
      </div>
    </section>

    <section class="mini-grid fade">
      ${eng}
      <article class="card mini" data-href="#/tasks">
        <div class="mini-ring">${ring(st.pct, 64, 6)}<span>${num(st.pct)}٪</span></div>
        <div><p class="mini-k">المهام</p><p class="mini-s">${num(st.done)} من ${num(st.total)} مكتملة</p></div>
      </article>
      <article class="card mini" data-href="#/budget">
        <div class="mini-head"><span class="mini-ic">${icon('wallet')}</span><span class="mini-k">الميزانية</span></div>
        <p class="mini-v sm">${money(b.remaining)}</p>
        <p class="mini-s">متبقٍ من ${moneyText(b.total)}</p>
        ${bar(b.pct, b.pct > 100 ? 'var(--danger)' : 'var(--gold)')}
      </article>
    </section>

    <div class="two-col">
      <section class="card fade">
        <div class="card-head"><h3>الخطوات القادمة</h3><a href="#/tasks" class="link">عرض الكل ${icon('chevL')}</a></div>
        ${st.overdue ? `<a href="#/tasks" class="notice" data-action="show-overdue">${icon('alert')}<span>لديكما ${overdueText(st.overdue)}</span>${icon('chevL')}</a>` : ''}
        ${upcoming.length ? `<ul class="task-list">${upcoming.map(taskRow).join('')}</ul>` : empty('heart', 'كل المهام مكتملة', 'أحسنتما! استمتعا بالأيام القادمة.')}
      </section>
      <div class="stack">
        <section class="card quote fade">
          <div class="quote-head"><span class="mini-ic gold">${icon('sparkle')}</span><span class="mini-k">رسالة اليوم</span>
            <button class="icon-btn sm" data-action="next-quote" aria-label="رسالة أخرى">${icon('refresh')}</button></div>
          <p class="quote-text">${quoteOfDay()}</p>
          <p class="quote-note">${contextualNote()}</p>
        </section>
        <a class="card phase-card fade" href="#/timeline">
          <span class="mini-ic">${icon('timeline')}</span>
          <div><p class="mini-k">المرحلة الحالية</p><p class="phase-name">${ph.title}</p><p class="mini-s">${ph.hint}</p></div>
          ${icon('chevL', 'muted')}
        </a>
      </div>
    </div>`;
  }

  // Loose Arabic matching: ignore diacritics and hamza/taa-marbuta spelling variants.
  const norm = s => (s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  function filteredTasks() {
    const q = norm(ui.query.trim());
    return state.tasks.filter(t =>
      (ui.cat === 'all' || t.category === ui.cat) &&
      (!q || norm(t.title).includes(q) || norm(t.note).includes(q)) &&
      (ui.status === 'all' || (ui.status === 'open' && !t.done) || (ui.status === 'done' && t.done) || (ui.status === 'overdue' && isOverdue(t)))
    ).sort(byDue);
  }

  function taskListHTML() {
    const list = filteredTasks();
    if (!list.length) {
      return ui.status === 'overdue' ? empty('check', 'لا توجد مهام متأخرة', 'أنتما على المسار الصحيح.') : empty('tasks', 'لا توجد مهام هنا', 'جرّبا تغيير التصفية أو أضيفا مهمة جديدة.');
    }
    if (ui.status === 'all') {
      const open = list.filter(t => !t.done), done = list.filter(t => t.done);
      return `${open.length ? `<ul class="task-list">${open.map(taskRow).join('')}</ul>` : ''}
        ${done.length ? `<button class="collapse-btn ${ui.doneOpen ? 'open' : ''}" data-action="toggle-done">${icon('chevD')}<span>المكتملة (${num(done.length)})</span></button>
        ${ui.doneOpen ? `<ul class="task-list">${done.map(taskRow).join('')}</ul>` : ''}` : ''}`;
    }
    return `<ul class="task-list">${list.map(taskRow).join('')}</ul>`;
  }

  function viewTasks() {
    const st = taskStats();
    const segs = [['open', 'المتبقية'], ['overdue', 'المتأخرة'], ['done', 'المكتملة'], ['all', 'الكل']];
    return `
    <section class="page-head fade">
      <div><h1 class="h1">قائمة المهام</h1><p class="sub">${num(st.done)} من ${num(st.total)} مكتملة${st.overdue ? ` · <span class="txt-warn">${overdueText(st.overdue)}</span>` : ''}</p></div>
      <button class="btn btn-primary" data-action="new-task">${icon('plus')}<span>مهمة جديدة</span></button>
    </section>
    <div class="progress-strip fade">${bar(st.pct, 'var(--gold)', 'lg')}<span>${num(st.pct)}٪</span></div>
    <div class="search fade">${icon('search')}<input type="search" placeholder="ابحث في المهام…" value="${esc(ui.query)}" data-input="task-search" aria-label="بحث"></div>
    <div class="seg fade" role="tablist">${segs.map(([k, l]) => `<button role="tab" class="${ui.status === k ? 'on' : ''}" data-action="status" data-v="${k}">${l}${k === 'overdue' && st.overdue ? `<span class="seg-badge">${num(st.overdue)}</span>` : ''}</button>`).join('')}</div>
    <div class="chips fade">
      <button class="chip ${ui.cat === 'all' ? 'on' : ''}" data-action="cat" data-v="all">جميع الفئات</button>
      ${CATEGORIES.map(c => { const n = state.tasks.filter(t => t.category === c.id).length; return n ? `<button class="chip ${ui.cat === c.id ? 'on' : ''}" data-action="cat" data-v="${c.id}" style="--c:${c.color}"><i></i>${c.name}</button>` : ''; }).join('')}
    </div>
    <section class="card list-card fade" id="task-list">${taskListHTML()}</section>
    <button class="fab" data-action="new-task" aria-label="مهمة جديدة">${icon('plus')}</button>`;
  }

  function viewTimeline() {
    const cur = currentPhase(), wd = parseDate(state.profile.weddingDate), dl = daysLeft();
    const curIdx = PHASES.indexOf(cur);
    if (!ui.openPhases.size) ui.openPhases.add(cur.id);
    const rangeText = p => {
      if (p.id === 'pd') return fmtDate(wd, { day: 'numeric', month: 'long', year: 'numeric' });
      const end = addDays(wd, -(p.to + 1));
      if (p.from === Infinity) return `حتى ${fmtDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
      const start = addDays(wd, -p.from);
      return `${fmtDate(start, { day: 'numeric', month: 'short' })} – ${fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    };
    const items = PHASES.map((p, i) => {
      const tasks = state.tasks.filter(t => t.dueDate && phaseOfTask(t) === p).sort(byDue);
      const st = taskStats(tasks);
      const status = i < curIdx ? 'past' : i === curIdx ? 'current' : 'future';
      const open = ui.openPhases.has(p.id);
      const complete = st.total > 0 && st.done === st.total;
      return `<li class="phase ${status} ${complete ? 'complete' : ''} ${open ? 'open' : ''}">
        <span class="node">${complete ? icon('check') : p.id === 'pd' ? icon('heart') : ''}</span>
        <div class="phase-card2">
          <button class="phase-top" data-action="toggle-phase" data-id="${p.id}" aria-expanded="${open}">
            <div class="phase-info">
              <div class="phase-row">${status === 'current' ? '<span class="now-pill">المرحلة الحالية</span>' : ''}<span class="phase-range">${rangeText(p)}</span></div>
              <h3>${p.title}</h3>
              <p class="mini-s">${p.hint}</p>
            </div>
            <div class="phase-prog">${st.total ? `${ring(st.pct, 46, 4, complete ? 'var(--green)' : 'var(--gold)')}<span>${num(st.done)}/${num(st.total)}</span>` : ''}</div>
            ${icon('chevD', 'phase-chev')}
          </button>
          ${open ? `<div class="phase-tasks">${tasks.length ? `<ul class="task-list">${tasks.map(taskRow).join('')}</ul>` : '<p class="mini-s pad">لا توجد مهام في هذه المرحلة.</p>'}
            <button class="btn btn-ghost sm" data-action="new-task" data-due="${toISO(addDays(wd, -(p.id === 'pd' ? 0 : p.to + 1)))}">${icon('plus')}<span>إضافة مهمة لهذه المرحلة</span></button></div>` : ''}
        </div>
      </li>`;
    }).join('');
    return `
    <section class="page-head fade"><div><h1 class="h1">مراحل التحضير</h1>
      <p class="sub">${dl > 0 ? `متبقٍ ${count(dl, U.dayNom)} ·أنتما الآن في «${cur.title}»` : dl === 0 ? 'اليوم هو يوم الزفاف' : 'اكتملت الرحلة، مبارك!'}</p></div></section>
    <ol class="timeline fade">${items}</ol>`;
  }

  const STATUS = { paid: 'مدفوع', deposit: 'عربون', due: 'مستحق' };

  function expenseRow(x) {
    return `<li class="exp" data-action="open-expense" data-id="${x.id}">
      ${catBadge(x.category, true)}
      <div class="exp-body"><p class="task-title">${esc(x.title)}</p><p class="task-meta">${fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' })}<span class="dot-sep"></span><span class="st st-${x.status}">${STATUS[x.status]}</span></p></div>
      <p class="exp-amt">${money(x.amount)}</p>
    </li>`;
  }

  function viewBudget() {
    const b = budgetStats();
    const segs = b.cats.filter(c => c.committed > 0).map(c => ({ value: c.committed, color: c.color, label: c.name }));
    const exp = [...state.expenses].sort((a, z) => z.date.localeCompare(a.date));
    const unalloc = b.total - b.allocated;
    return `
    <section class="page-head fade">
      <div><h1 class="h1">الميزانية</h1><p class="sub">تابعا المصروفات والدفعات القادمة بوضوح</p></div>
      <button class="btn btn-primary" data-action="new-expense">${icon('plus')}<span>مصروف جديد</span></button>
    </section>
    <section class="card budget-sum fade">
      <div class="donut-wrap">${donut(segs)}<div class="donut-c"><span class="k">مُلتزم به</span><span class="v">${num(b.pct)}٪</span></div></div>
      <div class="sum-grid">
        <button class="sum-item total" data-action="edit-total"><span class="k">الميزانية الكلية ${icon('edit', 'xs')}</span><span class="v">${money(b.total)}</span></button>
        <div class="sum-item"><span class="k"><i class="sw" style="background:var(--green)"></i>المدفوع</span><span class="v">${money(b.paid)}</span></div>
        <div class="sum-item"><span class="k"><i class="sw" style="background:var(--gold)"></i>دفعات قادمة</span><span class="v">${money(b.due)}</span></div>
        <div class="sum-item"><span class="k"><i class="sw" style="background:var(--ring-track)"></i>المتبقي</span><span class="v ${b.remaining < 0 ? 'txt-danger' : ''}">${money(b.remaining)}</span></div>
      </div>
    </section>
    ${unalloc !== 0 ? `<p class="hint fade">${icon('alert')} ${unalloc > 0 ? `مبلغ ${moneyText(unalloc)} غير موزّع على البنود.` : `مجموع المخصصات يتجاوز الميزانية بـ ${moneyText(-unalloc)}.`}</p>` : ''}
    <div class="two-col">
      <section class="card fade">
        <div class="card-head"><h3>البنود</h3><span class="mini-s">اضغطا على البند لتعديل المخصص</span></div>
        <ul class="cat-list">${b.cats.map(c => {
          const pct = c.alloc ? c.committed / c.alloc * 100 : (c.committed ? 100 : 0);
          return `<li class="cat-row" data-action="open-category" data-id="${c.id}">
            ${catBadge(c.id)}
            <div class="cat-body">
              <div class="cat-line"><span class="cat-name">${c.name}</span><span class="cat-amt ${c.over ? 'txt-danger' : ''}">${num(Math.round(c.committed))} <span class="muted">/ ${num(c.alloc)}</span></span></div>
              <div class="bar stacked"><span style="width:${clamp(c.alloc ? c.paid / c.alloc * 100 : 0, 0, 100)}%;background:${c.over ? 'var(--danger)' : 'var(--green)'}"></span><span style="width:${clamp(c.alloc ? c.due / c.alloc * 100 : 0, 0, 100 - clamp(c.alloc ? c.paid / c.alloc * 100 : 0, 0, 100))}%;background:var(--gold-soft)"></span></div>
              ${c.over ? `<p class="cat-warn">${icon('alert')} تجاوز المخصص بـ ${moneyText(c.committed - c.alloc)}</p>` : ''}
            </div></li>`;
        }).join('')}</ul>
      </section>
      <section class="card fade">
        <div class="card-head"><h3>المصروفات</h3><span class="mini-s">${num(exp.length)} عملية</span></div>
        ${exp.length ? `<ul class="exp-list">${exp.map(expenseRow).join('')}</ul>` : empty('wallet', 'لا توجد مصروفات بعد', 'سجّلا أول دفعة أو عربون لتظهر هنا.')}
      </section>
    </div>
    <button class="fab" data-action="new-expense" aria-label="مصروف جديد">${icon('plus')}</button>`;
  }

  function weeklyDone() {
    const t = today(), weeks = [];
    for (let i = 7; i >= 0; i--) {
      const end = addDays(t, -i * 7), start = addDays(end, -6);
      const n = state.tasks.filter(x => x.done && x.doneAt && parseDate(x.doneAt) >= start && parseDate(x.doneAt) <= end).length;
      weeks.push({ n, label: fmtDate(start, { day: 'numeric', month: 'numeric' }) });
    }
    return weeks;
  }

  function viewProgress() {
    const st = taskStats(), b = budgetStats(), pc = pace(), dl = daysLeft();
    const weeks = weeklyDone(), maxW = Math.max(1, ...weeks.map(w => w.n));
    const paceTxt = { good: ['على المسار الصحيح', 'إنجازكما يواكب الوقت المتبقي تمامًا.'], close: ['قريبان من المسار', `هناك ${overdueText(st.overdue)}، يمكن تداركها بسهولة.`], behind: ['يحتاج إلى دفعة', 'خصّصا هذا الأسبوع لإنهاء المهام المتأخرة.'] }[pc.level];
    const ach = achievements();
    return `
    <section class="page-head fade"><div><h1 class="h1">التقدّم</h1><p class="sub">صورة شاملة لرحلة التحضير</p></div></section>
    <section class="card overview fade">
      <div class="ov-ring">${ring(st.pct, 132, 10)}<div class="ov-c"><span class="v">${num(st.pct)}٪</span><span class="k">مكتمل</span></div></div>
      <div class="ov-body">
        <span class="pace pace-${pc.level}">${icon(pc.level === 'good' ? 'check' : 'alert')}${paceTxt[0]}</span>
        <p class="ov-txt">${paceTxt[1]}</p>
        <div class="time-line"><div class="tl-k"><span>مضى من فترة التحضير</span><span>${num(pc.elapsed)}٪</span></div>${bar(pc.elapsed, 'var(--blush-deep)')}</div>
      </div>
    </section>
    <section class="stats fade">
      ${[['check', num(st.done), 'مهمة مكتملة'], ['tasks', num(st.left), 'مهمة متبقية'], ['alert', num(st.overdue), 'مهمة متأخرة'], ['clock', num(Math.max(0, dl)), 'يومًا متبقيًا']]
        .map(([ic, v, k], i) => `<div class="stat ${i === 2 && st.overdue ? 'warn' : ''}">${icon(ic)}<span class="v">${v}</span><span class="k">${k}</span></div>`).join('')}
    </section>
    <div class="two-col">
      <section class="card fade">
        <div class="card-head"><h3>الإنجاز حسب الفئة</h3></div>
        <ul class="hbars">${CATEGORIES.map(c => { const s = taskStats(state.tasks.filter(t => t.category === c.id)); return s.total ? `<li><div class="cat-line"><span class="cat-name">${catBadge(c.id, true)}${c.name}</span><span class="muted">${num(s.done)}/${num(s.total)}</span></div>${bar(s.pct, c.color)}</li>` : ''; }).join('')}</ul>
      </section>
      <div class="stack">
        <section class="card fade">
          <div class="card-head"><h3>المهام المنجزة أسبوعيًا</h3><span class="mini-s">آخر ${num(8)} أسابيع</span></div>
          <div class="vbars">${weeks.map((w, i) => `<div class="vb ${i === weeks.length - 1 ? 'now' : ''}"><span class="vb-n">${w.n ? num(w.n) : ''}</span><span class="vb-b" style="height:${Math.max(4, w.n / maxW * 100)}%"></span><span class="vb-l">${w.label}</span></div>`).join('')}</div>
        </section>
        <section class="card fade">
          <div class="card-head"><h3>الميزانية</h3><a class="link" href="#/budget">التفاصيل ${icon('chevL')}</a></div>
          <div class="bud-mini"><div><span class="k">مُلتزم به</span><span class="v">${money(b.committed)}</span></div><div><span class="k">من أصل</span><span class="v">${money(b.total)}</span></div></div>
          ${bar(b.pct, b.pct > 100 ? 'var(--danger)' : 'var(--green)', 'lg')}
          <p class="mini-s mt">${b.cats.filter(c => c.over).length ? `${num(b.cats.filter(c => c.over).length)} بند تجاوز المخصص` : 'جميع البنود ضمن المخصص'}</p>
        </section>
      </div>
    </div>
    <section class="card fade">
      <div class="card-head"><h3>الإنجازات</h3><span class="mini-s">${num(ach.filter(a => a.got).length)} من ${num(ach.length)}</span></div>
      <div class="badges">${ach.map(a => `<div class="ach ${a.got ? 'got' : ''}"><span class="ach-ic">${icon(a.icon)}</span><span class="ach-t">${a.title}</span><span class="ach-d">${a.desc}</span></div>`).join('')}</div>
    </section>`;
  }

  const sw = (key, on, label, sub = '') => `<label class="row-set"><div><span class="rs-t">${label}</span>${sub ? `<span class="rs-s">${sub}</span>` : ''}</div>
    <span class="switch"><input type="checkbox" data-pref="${key}" ${on ? 'checked' : ''}><i></i></span></label>`;

  function viewSettings() {
    const p = state.profile, r = state.reminders;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const permTxt = { granted: 'مفعّلة على هذا الجهاز', denied: 'محظورة من المتصفح', default: 'غير مفعّلة بعد', unsupported: 'غير مدعومة في هذا المتصفح' }[perm];
    return `
    <section class="page-head fade"><div><h1 class="h1">الإعدادات</h1><p class="sub">بياناتكما وتفضيلات التذكير والعرض</p></div></section>
    <div class="two-col">
      <form class="card form fade" data-form="profile">
        <div class="card-head"><h3>بياناتنا</h3></div>
        <div class="f-row"><label class="field"><span>الاسم الأول</span><input name="partner1" required value="${esc(p.partner1)}"></label>
          <label class="field"><span>الاسم الثاني</span><input name="partner2" required value="${esc(p.partner2)}"></label></div>
        <div class="f-row"><label class="field"><span>تاريخ الزفاف</span><input type="date" name="weddingDate" required value="${p.weddingDate}"></label>
          <label class="field"><span>الوقت</span><input type="time" name="weddingTime" value="${p.weddingTime}"></label></div>
        <div class="f-row"><label class="field"><span>المناسبة الثانية</span><input name="engagementLabel" value="${esc(p.engagementLabel)}" placeholder="الملكة / الخطوبة"></label>
          <label class="field"><span>تاريخها</span><input type="date" name="engagementDate" value="${p.engagementDate}"></label></div>
        <div class="f-row"><label class="field"><span>المدينة</span><input name="city" value="${esc(p.city)}"></label>
          <label class="field"><span>القاعة</span><input name="venue" value="${esc(p.venue)}"></label></div>
        <button class="btn btn-primary block">حفظ التغييرات</button>
      </form>
      <div class="stack">
        <section class="card fade">
          <div class="card-head"><h3>التذكيرات</h3></div>
          ${sw('enabled', r.enabled, 'تفعيل التذكيرات')}
          <div class="${r.enabled ? '' : 'disabled'}">
            ${sw('motivation', r.motivation, 'رسالة تحفيزية يومية')}
            ${sw('tasks', r.tasks, 'تذكير بالمهام القريبة والمتأخرة')}
            <div class="row-set"><span class="rs-t">التذكير قبل الموعد بـ</span>
              <div class="seg sm">${[1, 3, 7].map(d => `<button type="button" class="${r.daysBefore === d ? 'on' : ''}" data-action="days-before" data-v="${d}">${count(d, U.day)}</button>`).join('')}</div></div>
            <label class="row-set"><span class="rs-t">وقت التذكير اليومي</span><input type="time" class="time-in" data-pref-input="time" value="${r.time}"></label>
            ${sw('weekly', r.weekly, 'ملخص أسبوعي للتقدّم', 'كل يوم جمعة')}
            ${sw('budget', r.budget, 'تنبيه عند اقتراب بند من حدّه', `عند ${num(r.budgetThreshold)}٪ من المخصص`)}
          </div>
          <div class="perm"><div><span class="rs-t">إشعارات المتصفح</span><span class="rs-s">${permTxt}</span></div>
            ${perm === 'granted' ? `<button class="btn btn-ghost sm" data-action="test-notify">إرسال تجربة</button>` : perm === 'default' ? `<button class="btn btn-gold sm" data-action="request-notify">تفعيل</button>` : ''}</div>
        </section>
        <section class="card fade">
          <div class="card-head"><h3>العرض</h3></div>
          <div class="row-set"><span class="rs-t">الأرقام</span><div class="seg sm">
            <button type="button" class="${state.prefs.digits === 'latn' ? 'on' : ''}" data-action="digits" data-v="latn">123</button>
            <button type="button" class="${state.prefs.digits === 'arab' ? 'on' : ''}" data-action="digits" data-v="arab">١٢٣</button></div></div>
          ${sw('hijri', state.prefs.hijri, 'إظهار التاريخ الهجري')}
        </section>
        <section class="card fade">
          <div class="card-head"><h3>البيانات</h3></div>
          <p class="mini-s">تُحفظ بياناتكما على هذا الجهاز فقط.</p>
          <div class="btn-row">
            <button class="btn btn-ghost" data-action="export">${icon('download')}<span>تصدير نسخة</span></button>
            <button class="btn btn-ghost" data-action="load-demo">${icon('sparkle')}<span>بيانات تجريبية</span></button>
            <button class="btn btn-danger-ghost" data-action="reset">${icon('trash')}<span>مسح البيانات</span></button>
          </div>
        </section>
      </div>
    </div>`;
  }

  function viewOnboarding() {
    const def = toISO(addDays(today(), 180));
    return `<div class="onb">
      <div class="onb-hero">
        <div class="onb-orn" aria-hidden="true"></div>
        ${logo(64)}
        <h1 class="onb-title">موعدنا</h1>
        <p class="onb-en">Mawedna</p>
        <p class="onb-tag">رفيقكما الهادئ للتحضير لأجمل يوم.<br>عدّ تنازلي، مهام، ميزانية، وتحفيز يومي، في مكان واحد.</p>
      </div>
      <form class="onb-card" data-form="onboard">
        <h2>لنبدأ رحلتكما</h2>
        <p class="sub">بعض التفاصيل البسيطة، ويمكن تعديلها لاحقًا.</p>
        <div class="f-row"><label class="field"><span>اسمكِ / اسمكَ</span><input name="partner1" required placeholder="سارة" autocomplete="off"></label>
          <label class="field"><span>اسم الشريك</span><input name="partner2" required placeholder="عبدالله" autocomplete="off"></label></div>
        <div class="f-row"><label class="field"><span>تاريخ الزفاف</span><input type="date" name="weddingDate" required value="${def}" min="${toISO(today())}"></label>
          <label class="field"><span>الوقت</span><input type="time" name="weddingTime" value="20:00"></label></div>
        <label class="field"><span>موعد الملكة / الخطوبة <em>(اختياري)</em></span><input type="date" name="engagementDate"></label>
        <div class="f-row"><label class="field"><span>المدينة</span><input name="city" placeholder="الرياض"></label>
          <label class="field"><span>الميزانية التقديرية (ر.س)</span><input name="budget" type="number" inputmode="numeric" min="0" step="500" value="150000" required></label></div>
        <button class="btn btn-primary block lg">ابدأ التخطيط</button>
        <button type="button" class="btn btn-link block" data-action="demo-start">أو استعرض التطبيق ببيانات تجريبية</button>
      </form>
    </div>`;
  }

  /* ---------- sheets ---------- */
  function openSheet(html, cls = '') {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
      <div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
    document.body.classList.add('no-scroll');
    void root.offsetHeight; // commit the hidden state so the transition runs
    root.classList.add('show');
    const f = root.querySelector('input:not([type=hidden]):not([type=date]), textarea');
    if (f && window.matchMedia('(min-width: 720px)').matches) f.focus();
  }
  function closeSheet() {
    const root = $('#sheet-root');
    root.classList.remove('show');
    document.body.classList.remove('no-scroll');
    setTimeout(() => { if (!root.classList.contains('show')) root.innerHTML = ''; }, 220);
  }
  const sheetHead = (title, extra = '') => `<div class="sheet-head"><h3>${title}</h3>${extra}<button class="icon-btn sm" data-action="close-sheet" aria-label="إغلاق">${icon('x')}</button></div>`;
  const catOptions = sel => CATEGORIES.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}</option>`).join('');

  function taskSheet(id, due) {
    const t = state.tasks.find(x => x.id === id) || { title: '', category: ui.cat !== 'all' ? ui.cat : 'other', priority: 'medium', dueDate: due || toISO(addDays(today(), 7)), note: '' };
    openSheet(`${sheetHead(id ? 'تعديل المهمة' : 'مهمة جديدة')}
      <form class="form" data-form="task" data-id="${id || ''}">
        <label class="field"><span>المهمة</span><input name="title" required value="${esc(t.title)}" placeholder="مثال: حجز موعد تجربة المكياج"></label>
        <div class="f-row"><label class="field"><span>الفئة</span><select name="category">${catOptions(t.category)}</select></label>
          <label class="field"><span>الموعد</span><input type="date" name="dueDate" value="${t.dueDate || ''}"></label></div>
        <div class="field"><span>الأولوية</span><div class="seg full" data-radio="priority">
          ${[['low', 'عادية'], ['medium', 'متوسطة'], ['high', 'مهمة']].map(([k, l]) => `<button type="button" class="${t.priority === k ? 'on' : ''}" data-action="radio" data-v="${k}">${l}</button>`).join('')}
        </div><input type="hidden" name="priority" value="${t.priority}"></div>
        <label class="field"><span>ملاحظات</span><textarea name="note" rows="3" placeholder="أرقام تواصل، أفكار، تفاصيل…">${esc(t.note)}</textarea></label>
        <div class="sheet-actions">
          ${id ? `<button type="button" class="btn btn-danger-ghost" data-action="delete-task" data-id="${id}">${icon('trash')}<span>حذف</span></button>` : ''}
          <button class="btn btn-primary grow">${id ? 'حفظ' : 'إضافة المهمة'}</button>
        </div>
      </form>`);
  }

  function expenseSheet(id, catId) {
    const x = state.expenses.find(e => e.id === id) || { title: '', amount: '', category: catId || 'venue', date: toISO(today()), status: 'paid', note: '' };
    openSheet(`${sheetHead(id ? 'تعديل المصروف' : 'مصروف جديد')}
      <form class="form" data-form="expense" data-id="${id || ''}">
        <label class="field"><span>الوصف</span><input name="title" required value="${esc(x.title)}" placeholder="مثال: عربون المصوّرة"></label>
        <div class="f-row"><label class="field"><span>المبلغ (ر.س)</span><input name="amount" type="number" inputmode="decimal" min="0" step="any" required value="${x.amount}"></label>
          <label class="field"><span>البند</span><select name="category">${catOptions(x.category)}</select></label></div>
        <div class="field"><span>الحالة</span><div class="seg full" data-radio="status">
          ${Object.entries(STATUS).map(([k, l]) => `<button type="button" class="${x.status === k ? 'on' : ''}" data-action="radio" data-v="${k}">${l}</button>`).join('')}
        </div><input type="hidden" name="status" value="${x.status}"></div>
        <label class="field"><span>${x.status === 'due' ? 'تاريخ الاستحقاق' : 'التاريخ'}</span><input type="date" name="date" required value="${x.date}"></label>
        <label class="field"><span>ملاحظات</span><textarea name="note" rows="2">${esc(x.note)}</textarea></label>
        <div class="sheet-actions">
          ${id ? `<button type="button" class="btn btn-danger-ghost" data-action="delete-expense" data-id="${id}">${icon('trash')}<span>حذف</span></button>` : ''}
          <button class="btn btn-primary grow">${id ? 'حفظ' : 'إضافة'}</button>
        </div>
      </form>`);
  }

  function categorySheet(id) {
    const c = budgetStats().cats.find(x => x.id === id);
    const ex = state.expenses.filter(x => x.category === id).sort((a, z) => z.date.localeCompare(a.date));
    openSheet(`${sheetHead(`${catBadge(id, true)} ${c.name}`)}
      <div class="cat-sum"><div><span class="k">المدفوع</span><span class="v">${money(c.paid)}</span></div><div><span class="k">مستحق</span><span class="v">${money(c.due)}</span></div><div><span class="k">المتبقي</span><span class="v ${c.alloc - c.committed < 0 ? 'txt-danger' : ''}">${money(c.alloc - c.committed)}</span></div></div>
      <form class="form" data-form="alloc" data-id="${id}">
        <label class="field"><span>المبلغ المخصص (ر.س)</span><input name="alloc" type="number" inputmode="numeric" min="0" step="any" value="${c.alloc}"></label>
        <button class="btn btn-primary block">حفظ المخصص</button>
      </form>
      <div class="card-head mt"><h3>مصروفات البند</h3><button class="btn btn-ghost sm" data-action="new-expense" data-cat="${id}">${icon('plus')}<span>إضافة</span></button></div>
      ${ex.length ? `<ul class="exp-list">${ex.map(expenseRow).join('')}</ul>` : '<p class="mini-s">لا توجد مصروفات في هذا البند.</p>'}`);
  }

  function alertsSheet() {
    const list = reminders(), r = state.reminders;
    openSheet(`${sheetHead('التنبيهات')}
      ${r.enabled && r.motivation ? `<div class="alert-item quote-mini">${icon('sparkle')}<div><p class="task-title">${quoteOfDay()}</p><p class="task-meta">رسالة اليوم · ${fmtTime(r.time)}</p></div></div>` : ''}
      ${!r.enabled ? empty('bell', 'التذكيرات متوقفة', 'يمكنكما تفعيلها من الإعدادات.') : list.length ? `<ul class="alerts">${list.map(a => `<li class="alert-item k-${a.kind}" ${a.id ? `data-action="open-task" data-id="${a.id}"` : a.cat ? `data-action="open-category" data-id="${a.cat}"` : a.expense ? `data-action="open-expense" data-id="${a.expense}"` : ''}>${icon(a.icon)}<div><p class="task-title">${esc(a.title)}</p><p class="task-meta">${a.sub}</p></div></li>`).join('')}</ul>`
        : empty('check', 'لا توجد تنبيهات', 'كل شيء على ما يرام.')}
      <a href="#/settings" class="btn btn-ghost block" data-action="close-sheet">${icon('settings')}<span>تفضيلات التذكير</span></a>`);
  }

  function confirmSheet(title, msg, yesLabel, cb) {
    confirmCb = cb;
    openSheet(`${sheetHead(title)}<p class="confirm-msg">${msg}</p>
      <div class="sheet-actions"><button class="btn btn-ghost grow" data-action="close-sheet">إلغاء</button><button class="btn btn-danger grow" data-action="confirm-yes">${yesLabel}</button></div>`, 'sm');
  }

  function toast(msg, ic = 'check') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon(ic)}<span>${msg}</span>`;
    $('#toast-root').appendChild(el);
    void el.offsetHeight;
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
  }

  /* ---------- render ---------- */
  const VIEWS = { home: viewHome, tasks: viewTasks, timeline: viewTimeline, budget: viewBudget, progress: viewProgress, settings: viewSettings };

  function render(scrollTop = false) {
    clearInterval(tickTimer);
    if (!state) {
      document.body.classList.add('is-onb');
      $('#app').innerHTML = viewOnboarding();
      return;
    }
    document.body.classList.remove('is-onb');
    if (!$('.layout')) renderShell();
    const y = window.scrollY;
    // Only animate cards in on navigation; in-place updates (ticking a task) should not flash.
    $('#view').classList.toggle('static', !scrollTop);
    $('#view').innerHTML = VIEWS[ui.route]();
    updateChrome();
    if (scrollTop) window.scrollTo(0, 0); else window.scrollTo(0, y);
    if (ui.route === 'home') { tickCountdown(); tickTimer = setInterval(tickCountdown, 1000); }
  }

  function tickCountdown() {
    let ms = weddingAt() - Date.now();
    ms = Math.abs(ms);
    const v = { d: Math.floor(ms / DAY), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 };
    document.querySelectorAll('[data-cd]').forEach(el => {
      const k = el.dataset.cd;
      el.textContent = num(v[k], { minimumIntegerDigits: k === 'd' ? 1 : 2, useGrouping: false });
    });
  }

  function route() {
    const r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    ui.route = VIEWS[r] ? r : 'home';
    render(true);
  }

  /* ---------- mutations ---------- */
  function commit(msg, ic) { save(); render(); if (msg) toast(msg, ic); }

  function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const before = taskStats().pct;
    t.done = !t.done; t.doneAt = t.done ? toISO(today()) : null;
    save();
    const after = taskStats().pct;
    const milestone = [25, 50, 75, 100].find(m => before < m && after >= m);
    render();
    if (t.done) toast(milestone ? (milestone === 100 ? 'اكتملت جميع المهام، ألف مبروك!' : `رائع! أنجزتما ${num(milestone)}٪ من المهام`) : 'أحسنتما! خطوة أقرب', milestone ? 'award' : 'check');
  }

  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

  function onSubmit(e) {
    const form = e.target.closest('form[data-form]'); if (!form) return;
    e.preventDefault();
    const d = formData(form), id = form.dataset.id;
    switch (form.dataset.form) {
      case 'onboard':
        state = createState(d);
        save(); location.hash = '#/home'; render(true);
        toast('أهلًا بكما في موعدنا', 'heart');
        break;
      case 'task': {
        const data = { title: d.title.trim(), category: d.category, dueDate: d.dueDate, priority: d.priority, note: d.note.trim() };
        if (!data.title) return;
        if (id) Object.assign(state.tasks.find(t => t.id === id), data);
        else state.tasks.push({ id: uid(), key: null, done: false, doneAt: null, ...data });
        closeSheet(); commit(id ? 'تم حفظ المهمة' : 'أُضيفت المهمة');
        break;
      }
      case 'expense': {
        const data = { title: d.title.trim(), amount: Math.abs(Number(d.amount)) || 0, category: d.category, date: d.date, status: d.status, note: d.note.trim() };
        if (!data.title) return;
        if (id) Object.assign(state.expenses.find(x => x.id === id), data);
        else state.expenses.push({ id: uid(), ...data });
        closeSheet(); commit(id ? 'تم حفظ المصروف' : 'أُضيف المصروف');
        break;
      }
      case 'alloc':
        state.budget.alloc[id] = Math.max(0, Number(d.alloc) || 0);
        closeSheet(); commit('تم تحديث المخصص');
        break;
      case 'total':
        state.budget.total = Math.max(0, Number(d.total) || 0);
        if (d.redistribute) state.budget.alloc = distribute(state.budget.total);
        closeSheet(); commit('تم تحديث الميزانية');
        break;
      case 'profile': {
        // Moving the wedding moves the open tasks with it, so the plan keeps its shape.
        const shift = diffDays(parseDate(state.profile.weddingDate), parseDate(d.weddingDate));
        if (shift) state.tasks.forEach(t => { if (!t.done && t.dueDate) t.dueDate = toISO(addDays(parseDate(t.dueDate), shift)); });
        Object.assign(state.profile, { ...d, partner1: d.partner1.trim(), partner2: d.partner2.trim(), engagementLabel: (d.engagementLabel || '').trim() || 'الملكة' });
        commit(shift ? 'تم الحفظ، وحُدّثت مواعيد المهام المتبقية' : 'تم حفظ البيانات');
        break;
      }
    }
  }

  function onClick(e) {
    const hrefCard = e.target.closest('[data-href]');
    const el = e.target.closest('[data-action]');
    if (!el) { if (hrefCard) location.hash = hrefCard.dataset.href; return; }
    const a = el.dataset.action, id = el.dataset.id, v = el.dataset.v;
    if (el.tagName === 'A' && a !== 'close-sheet' && a !== 'show-overdue') e.preventDefault();
    switch (a) {
      case 'toggle-task': e.stopPropagation(); toggleTask(id); break;
      case 'open-task': taskSheet(id); break;
      case 'new-task': taskSheet(null, el.dataset.due); break;
      case 'delete-task':
        confirmSheet('حذف المهمة', 'هل تريدان حذف هذه المهمة نهائيًا؟', 'حذف', () => { state.tasks = state.tasks.filter(t => t.id !== id); commit('حُذفت المهمة', 'trash'); });
        break;
      case 'status': ui.status = v; render(); break;
      case 'show-overdue': ui.status = 'overdue'; ui.cat = 'all'; break;
      case 'cat': ui.cat = v; render(); break;
      case 'toggle-done': ui.doneOpen = !ui.doneOpen; $('#task-list').innerHTML = taskListHTML(); break;
      case 'toggle-phase': ui.openPhases.has(id) ? ui.openPhases.delete(id) : ui.openPhases.add(id); render(); break;
      case 'next-quote': ui.quoteShift++; render(); break;
      case 'open-alerts': alertsSheet(); break;
      case 'new-expense': expenseSheet(null, el.dataset.cat); break;
      case 'open-expense': expenseSheet(id); break;
      case 'delete-expense':
        confirmSheet('حذف المصروف', 'سيُحذف هذا المصروف من السجل.', 'حذف', () => { state.expenses = state.expenses.filter(x => x.id !== id); commit('حُذف المصروف', 'trash'); });
        break;
      case 'open-category': categorySheet(id); break;
      case 'edit-total':
        openSheet(`${sheetHead('الميزانية الكلية')}<form class="form" data-form="total">
          <label class="field"><span>المبلغ (ر.س)</span><input name="total" type="number" inputmode="numeric" min="0" step="500" value="${state.budget.total}" required></label>
          <label class="check-line"><input type="checkbox" name="redistribute"><span>إعادة توزيع المخصصات على البنود تلقائيًا</span></label>
          <button class="btn btn-primary block">حفظ</button></form>`, 'sm');
        break;
      case 'radio': {
        const wrap = el.closest('[data-radio]');
        wrap.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
        wrap.parentElement.querySelector(`input[name=${wrap.dataset.radio}]`).value = v;
        if (wrap.dataset.radio === 'status') { const lbl = el.closest('form').querySelector('input[name=date]').previousElementSibling; lbl.textContent = v === 'due' ? 'تاريخ الاستحقاق' : 'التاريخ'; }
        break;
      }
      case 'days-before': state.reminders.daysBefore = Number(v); commit(); break;
      case 'digits': state.prefs.digits = v; commit(); break;
      case 'request-notify':
        Notification.requestPermission().then(p => { render(); if (p === 'granted') toast('تم تفعيل الإشعارات', 'bell'); });
        break;
      case 'test-notify':
        try { new Notification('موعدنا', { body: `${quoteOfDay()}\nمتبقٍ ${count(daysLeft(), U.day)} على الزفاف.`, lang: 'ar', dir: 'rtl' }); toast('أُرسل إشعار تجريبي', 'bell'); } catch (err) { toast('تعذّر إرسال الإشعار', 'alert'); }
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mawedna-${toISO(today())}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        break;
      }
      case 'load-demo':
        confirmSheet('تحميل بيانات تجريبية', 'ستُستبدل بياناتكما الحالية ببيانات تجريبية.', 'متابعة', () => { state = createDemo(); ui.openPhases.clear(); commit('حُمّلت البيانات التجريبية', 'sparkle'); });
        break;
      case 'reset':
        confirmSheet('مسح جميع البيانات', 'ستُحذف جميع المهام والمصروفات والإعدادات من هذا الجهاز. لا يمكن التراجع.', 'مسح', () => {
          try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
          state = null; ui.openPhases.clear(); location.hash = ''; render();
        });
        break;
      case 'demo-start':
        state = createDemo(); save(); location.hash = '#/home'; render(true);
        toast('هذه بيانات تجريبية، يمكنكما مسحها من الإعدادات', 'sparkle');
        break;
      case 'confirm-yes': { const cb = confirmCb; confirmCb = null; closeSheet(); cb && cb(); break; }
      case 'close-sheet': closeSheet(); break;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.pref) {
      if (el.dataset.pref === 'hijri') state.prefs.hijri = el.checked;
      else state.reminders[el.dataset.pref] = el.checked;
      commit();
    } else if (el.dataset.prefInput) {
      state.reminders[el.dataset.prefInput] = el.value; save();
    }
  }

  function onInput(e) {
    if (e.target.dataset.input === 'task-search') { ui.query = e.target.value; $('#task-list').innerHTML = taskListHTML(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet(); });
  window.addEventListener('hashchange', route);
  // Re-render when the day rolls over or the tab comes back, so countdown-derived text stays fresh.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) render(); });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // Needs HTTPS (or localhost); on a plain-http LAN address it is skipped and the app simply runs online.
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
