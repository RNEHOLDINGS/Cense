/* ---------------------------------------------------------------
   Cense — an RNE Holdings product
   Everything is stored in this browser via localStorage. No server,
   no account, no data leaves the machine.
   --------------------------------------------------------------- */

(function () {
  'use strict';

  var STORE_KEY = 'cense.v1';
  var LEGACY_KEY = 'budgetapp.v1';
  var THEME_KEY = 'cense.theme';
  var PRIVATE_KEY = 'cense.private';   /* amounts masked for shoulder-surfing */
  var DEMO_KEY = 'cense.demo';        /* '1' while the sample household is loaded */
  var PREDEMO_KEY = 'cense.predemo';  /* the real budget, parked while it is */

  /* ---------- small helpers ---------- */

  var uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  /* Ids end up inside HTML attributes and are used as cross-references between
     txns, plan items and buckets. A backup file is outside data — anything that
     is not a plain token gets a fresh id, and every reference to it is rewritten
     to match so nothing is orphaned. */
  var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

  var fmtMoney = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2
  });
  var fmtMoney0 = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  });
  /* Privacy mode. Masking only the income figure would be theatre — every
     bucket prints "55%" beside its allocation, so anyone glancing at the screen
     could divide one by the other and recover the salary. Every currency figure
     goes at once or none of them do. */
  var MASK = '••••';
  var hideMoney = false;

  var money = function (n) { return hideMoney ? MASK : fmtMoney.format(n || 0); };
  var money0 = function (n) { return hideMoney ? MASK : fmtMoney0.format(n || 0); };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var num = function (v) {
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };

  var pad = function (n) { return n < 10 ? '0' + n : String(n); };

  var todayISO = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  var monthOf = function (iso) { return (iso || '').slice(0, 7); };
  var currentYM = function () { return monthOf(todayISO()); };

  /* A date string is only real if the calendar agrees. "2026-02-31" and
     "2025-25-12" both look like dates and belong to no month the app can ever
     display — a charge dated either one is invisible everywhere while still
     sitting in storage. */
  var isYMD = function (v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v == null ? '' : v));
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(y, mo, 0).getDate();
  };

  var isYM = function (v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v == null ? '' : v)); };

  /* Every month helper falls back to the live month rather than propagating a
     malformed one, so no single bad value can strand the app on "Invalid Date"
     with the stepper arrows dead. */
  var monthLabel = function (ym) {
    if (!isYM(ym)) ym = currentYM();
    var p = ym.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  var monthShort = function (ym) {
    if (!isYM(ym)) ym = currentYM();
    var p = ym.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long' });
  };

  var shiftMonth = function (ym, delta) {
    if (!isYM(ym)) ym = currentYM();
    var p = ym.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  };

  var daysInMonth = function (ym) {
    if (!isYM(ym)) ym = currentYM();
    var p = ym.split('-');
    return new Date(Number(p[0]), Number(p[1]), 0).getDate();
  };

  var norm = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  };

  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  var Ordinal = function (n) {
    if (n % 100 >= 11 && n % 100 <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  /* Categorical slots, in the fixed validated order. Never cycled: a 7th
     bucket reuses the last slot rather than inventing a hue. */
  var SLOTS = [
    { id: 1, name: 'Blue',   css: 'var(--series-1)' },
    { id: 2, name: 'Aqua',   css: 'var(--series-2)' },
    { id: 3, name: 'Yellow', css: 'var(--series-3)' },
    { id: 4, name: 'Green',  css: 'var(--series-4)' },
    { id: 5, name: 'Violet', css: 'var(--series-5)' },
    { id: 6, name: 'Red',    css: 'var(--series-6)' }
  ];
  var slotCss = function (slot) {
    var s = SLOTS.filter(function (x) { return x.id === slot; })[0];
    return (s || SLOTS[SLOTS.length - 1]).css;
  };

  /* Flavour text for the starter buckets only. Rename a bucket and it keeps
     its blurb; invent a new one and it simply has none. */
  var BLURBS = {
    needs: 'Keeps the lights on.',
    wants: 'Chosen, not required.',
    bs:    'You know exactly what this is.',
    save:  'Future you says thanks.'
  };

  var ASSET_KINDS = [
    { id: 'retirement', name: 'Retirement', hint: '401(k), IRA, pension' },
    { id: 'property',   name: 'Property',   hint: 'What it would sell for, not what is left on the mortgage' },
    { id: 'business',   name: 'Business',   hint: 'Your share of anything you own' },
    { id: 'investment', name: 'Investments', hint: 'Brokerage, index funds, crypto' },
    { id: 'cash',       name: 'Cash',       hint: 'Current and savings accounts' },
    { id: 'vehicle',    name: 'Vehicles',   hint: 'Resale value' },
    { id: 'other',      name: 'Other',      hint: 'Anything else worth something' }
  ];

  /* Federal Reserve Survey of Consumer Finances, 2022 — the most recent
     published wave; the 2025 survey is still in the field and does not report
     until late 2026.

     These six bands are the finest the SCF publishes. Narrower ones (a figure
     for 23–27 year olds, say) do not exist anywhere authoritative — they would
     have to be interpolated, and an invented benchmark is worse than none in a
     screen people use to judge themselves.

     Median leads everywhere in the UI. The mean is carried only so it can be
     shown for what it is: under 35 it is 4.7x the median, because a handful of
     enormous fortunes drag it upward and almost nobody is near it. */
  var SCF = {
    year: 2022,
    bands: [
      { max: 34,  label: 'under 35', median: 39040,  mean: 183380 },
      { max: 44,  label: '35 to 44', median: 135300, mean: 548070 },
      { max: 54,  label: '45 to 54', median: 246700, mean: 971270 },
      { max: 64,  label: '55 to 64', median: 364270, mean: 1564070 },
      { max: 74,  label: '65 to 74', median: 410000, mean: 1780720 },
      { max: 999, label: '75+',      median: 334700, mean: 1620100 }
    ]
  };

  function bandForAge(age) {
    if (!age) return null;
    for (var i = 0; i < SCF.bands.length; i++) {
      if (age <= SCF.bands[i].max) return SCF.bands[i];
    }
    return SCF.bands[SCF.bands.length - 1];
  }

  /* ---------- state ---------- */

  function blankState() {
    return {
      version: 3,
      settings: {
        income: 0,
        carryover: true,     /* last month's overspend follows you into this one */
        startBalance: 0,     /* 0 = the cash-flow strip stays hidden */
        incomeDay: 1,
        age: 0,              /* optional; 0 means "not saying", and nothing breaks */
        returnPct: 7,        /* assumed annual growth for the projection */
        annualAdd: 0         /* what gets added to the pile each year */
      },
      /* kind 'save' means money that moved but was not consumed. It is the
         difference between "where it went" and "what you have left", and the
         two must never be added together. */
      buckets: [
        { id: 'needs', name: 'Needs',    pct: 55, slot: 1, kind: 'spend' },
        { id: 'wants', name: 'Wants',    pct: 20, slot: 2, kind: 'spend' },
        { id: 'bs',    name: 'Bullshit', pct: 5,  slot: 3, kind: 'spend' },
        { id: 'save',  name: 'Savings',  pct: 20, slot: 4, kind: 'save'  }
      ],
      plan: [],
      txns: [],
      debts: [],
      /* Anything that would show up on the asset side of a balance sheet.
         Net worth is these minus what is still owed on the Debts screen. */
      assets: [],
      /* A fund is a pot with a target. Its balance is never stored — it is the
         sum of what has been paid into it minus what has been taken out, so it
         cannot drift away from the transactions that justify it. */
      funds: [],
      applied: {},  /* "YYYY-MM" -> [planId, …] already posted for that month */
      memory: {}    /* normalized payee -> bucket id, for auto-categorizing */
    };
  }

  var state = blankState();
  /* openRows lives in ui rather than on the DOM node, because every edit
     re-renders the whole view and a class set on the old <tr> would not
     survive it. */
  var ui = { view: 'dashboard', month: currentYM(), search: '', lastPost: null, openRows: {}, undos: [] };

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_KEY);
      if (!raw) return false;
      state = migrate(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn('Could not read saved data:', e);
      /* Park the unreadable copy somewhere save() will not tread. Without this
         the app starts blank and the user's very next click overwrites the only
         copy of their budget with an empty one. */
      try {
        if (raw) localStorage.setItem(STORE_KEY + '.corrupt-' + todayISO(), raw);
      } catch (e2) { /* storage full or blocked — the warning below still shows */ }
      ui.loadFailed = true;
      return false;
    }
  }

  /* The only door between outside data and state. Everything that arrives from
     a backup file, a legacy key or a previous version comes through here, so
     this is where shape, type and id safety are established once. Nothing
     downstream re-checks, and nothing downstream should have to. */
  function migrate(s) {
    var base = blankState();
    if (!s || typeof s !== 'object') return base;

    /* One table for the whole file: a bucket id that has to be replaced is
       replaced identically wherever a txn, plan item or memory entry points
       at it. Ids that are already safe pass through untouched, so ordinary
       backups keep their ids and their references. */
    var remap = {};
    var reid = function (v) {
      var k = String(v == null ? '' : v);
      if (SAFE_ID.test(k)) return k;
      if (!remap[k]) remap[k] = uid();
      return remap[k];
    };
    var str = function (v) { return String(v == null ? '' : v); };
    var obj = function (x) { return x && typeof x === 'object'; };

    var buckets = (Array.isArray(s.buckets) && s.buckets.length ? s.buckets : base.buckets)
      .filter(obj)
      .map(function (b) {
        /* Older data has no kind. Infer it once from the id or the name the
           dashboard used to sniff at render time, so existing budgets keep
           behaving the way their owner set them up. */
        var kind = b.kind === 'save' || b.kind === 'spend' ? b.kind
                 : (b.id === 'save' || /sav|invest/i.test(str(b.name)) ? 'save' : 'spend');
        return { id: reid(b.id), name: str(b.name), pct: num(b.pct), slot: num(b.slot) || 1, kind: kind };
      });
    if (!buckets.length) buckets = base.buckets;

    var plan = (Array.isArray(s.plan) ? s.plan : []).filter(obj).map(function (p) {
      var row = {
        id: reid(p.id),
        bucketId: reid(p.bucketId),
        label: str(p.label),
        amount: num(p.amount),
        auto: !!p.auto,                      /* v1 had no recurring charges */
        day: Math.min(Math.max(num(p.day) || 1, 1), 31)
      };
      if (p.fundId != null) row.fundId = reid(p.fundId);
      if (p.debtId != null) row.debtId = reid(p.debtId);
      return row;
    });

    var assets = (Array.isArray(s.assets) ? s.assets : []).filter(obj).map(function (a) {
      return {
        id: reid(a.id),
        name: str(a.name),
        value: num(a.value),
        kind: ASSET_KINDS.some(function (k) { return k.id === a.kind; }) ? a.kind : 'other'
      };
    });

    var funds = (Array.isArray(s.funds) ? s.funds : []).filter(obj).map(function (f) {
      return {
        id: reid(f.id),
        name: str(f.name),
        target: num(f.target),
        every: Math.min(Math.max(Math.round(num(f.every)) || 0, 0), 120),
        dueMonth: Math.min(Math.max(Math.round(num(f.dueMonth)) || 0, 0), 12),
        bucketId: f.bucketId != null ? reid(f.bucketId) : ''
      };
    });

    /* An unparseable date becomes today rather than blank: a charge with no
       month is invisible in every view and can never be corrected or deleted
       through the UI, which is a worse outcome than one dated wrongly. */
    var txns = (Array.isArray(s.txns) ? s.txns : []).filter(obj).map(function (t) {
      var row = {
        id: reid(t.id),
        date: isYMD(t.date) ? t.date : todayISO(),
        payee: str(t.payee),
        amount: num(t.amount),
        bucketId: reid(t.bucketId),
        note: str(t.note)
      };
      if (t.planId != null) row.planId = reid(t.planId);
      if (t.fundId != null) row.fundId = reid(t.fundId);
      if (t.debtId != null) row.debtId = reid(t.debtId);
      return row;
    });

    /* balance is what you owed when you told Cense about it. What you owe now
       is that minus everything logged against it since, so a payment can never
       be counted in the ledger and forgotten by the balance. */
    var debts = (Array.isArray(s.debts) ? s.debts : []).filter(obj).map(function (d) {
      return {
        id: reid(d.id), name: str(d.name), balance: num(d.balance),
        /* Payday and some store credit run well past 100%, and those are
           precisely the debts where seeing the number matters most. */
        apr: Math.min(Math.max(num(d.apr), 0), 1000)
      };
    });

    var applied = {};
    if (obj(s.applied)) {
      Object.keys(s.applied).forEach(function (k) {
        if (isYM(k) && Array.isArray(s.applied[k])) {
          applied[k] = s.applied[k].map(function (x) { return reid(x); });
        }
      });
    }

    var memory = {};
    if (obj(s.memory)) {
      Object.keys(s.memory).forEach(function (k) {
        var key = norm(k);
        if (key && typeof s.memory[k] === 'string') memory[key] = reid(s.memory[k]);
      });
    }

    var set = obj(s.settings) ? s.settings : {};
    return {
      version: 3,
      settings: {
        income: num(set.income),
        carryover: set.carryover === undefined ? true : !!set.carryover,
        startBalance: num(set.startBalance),
        incomeDay: Math.min(Math.max(Math.round(num(set.incomeDay)) || 1, 1), 31),
        age: Math.min(Math.max(Math.round(num(set.age)) || 0, 0), 120),
        returnPct: set.returnPct === undefined ? 7 : Math.min(Math.max(num(set.returnPct), -20), 40),
        annualAdd: num(set.annualAdd)
      },
      buckets: buckets,
      plan: plan,
      txns: txns,
      debts: debts,
      assets: assets,
      funds: funds,
      applied: applied,
      memory: memory
    };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      ui.saveFailed = false;
    } catch (e) {
      /* Sticky, not a 3.8-second toast: once writes are failing, everything on
         screen is unsaved and a reload discards it. The user needs to still be
         told that ten edits later. */
      ui.saveFailed = true;
      toast('Could not save — browser storage may be full or blocked.');
    }
  }

  function commit() { save(); render(); }

  /* ---------- demo ---------- */

  /* A made-up household, built relative to today so it is never stale. It is
     embedded rather than fetched because the README tells people to double-click
     index.html, and fetch() is blocked on file:// — a demo that only works off a
     server is not a demo.

     The numbers are chosen to show the app having an opinion: Needs overspent
     last month and carrying in, a fund part-way to Christmas and short, a card
     with a rate on it, and an account that dips below zero four days before
     payday while still ending the month up. */
  function demoState() {
    var now = currentYM();
    var prev = shiftMonth(now, -1);
    var on = function (ym, day) { return ym + '-' + pad(Math.min(day, daysInMonth(ym))); };

    var txns = [];
    var add = function (ym, day, payee, amount, bucketId, extra) {
      var t = { id: 'dt' + (txns.length + 1), date: on(ym, day), payee: payee,
                amount: amount, bucketId: bucketId, note: '' };
      if (extra) Object.keys(extra).forEach(function (k) { t[k] = extra[k]; });
      txns.push(t);
    };

    var LAST = [
      [1, 'Rent', 1250, 'needs'], [2, 'Christmas fund', 70.83, 'save', { fundId: 'f-xmas' }],
      [2, 'Car fund', 75, 'save', { fundId: 'f-car' }], [4, 'Kroger', 112.38, 'needs'],
      [6, 'City Electric', 118, 'needs'], [7, 'Shell', 48.20, 'needs'],
      [8, 'Mobile', 65, 'needs'], [9, 'DoorDash', 38.75, 'bs'],
      [10, 'Thai Basil', 82.30, 'wants'], [11, 'Kroger', 94.15, 'needs'],
      [12, 'Car insurance', 142, 'needs'], [13, 'Home goods', 215, 'wants'],
      [14, 'Target', 63.40, 'wants'], [15, 'Brake repair', 128, 'needs', { fundId: 'f-car' }],
      [16, 'Uber Eats', 48.90, 'bs'], [17, 'Starbucks', 12.85, 'bs'],
      [18, 'Streaming', 34, 'wants'], [19, 'Kroger', 88.90, 'needs'],
      [20, 'Gym', 29, 'wants'], [21, 'Clothes', 118.99, 'wants'],
      [22, 'Card payment', 120, 'needs', { debtId: 'd-card' }],
      [23, 'DoorDash', 52.40, 'bs'], [25, 'Cinema', 34.50, 'wants'],
      [26, 'Shell', 52.60, 'needs'], [27, 'Overdraft fee', 35, 'bs'],
      [28, 'Amazon', 71.25, 'wants'], [30, 'Dentist', 245, 'needs']
    ];
    var THIS = [
      [1, 'Rent', 1250, 'needs', { planId: 'pd-rent' }],
      [2, 'Christmas fund', 70.83, 'save', { fundId: 'f-xmas', planId: 'pd-xmas' }],
      [2, 'Car fund', 75, 'save', { fundId: 'f-car', planId: 'pd-car' }],
      [3, 'Kroger', 104.22, 'needs'], [5, 'DoorDash', 41.60, 'bs'],
      [6, 'City Electric', 126.40, 'needs', { planId: 'pd-elec' }],
      [7, 'Shell', 51.10, 'needs'], [8, 'Mobile', 65, 'needs', { planId: 'pd-phone' }],
      [9, 'Starbucks', 9.75, 'bs'], [10, 'Target', 58.30, 'wants'],
      [11, 'Kroger', 97.85, 'needs'],
      [12, 'Car insurance', 142, 'needs', { planId: 'pd-ins' }],
      [13, 'Uber Eats', 36.20, 'bs'], [14, 'Amazon', 44.99, 'wants'],
      [18, 'Streaming', 34, 'wants', { planId: 'pd-stream' }],
      [20, 'Gym', 29, 'wants', { planId: 'pd-gym' }],
      [22, 'Card payment', 120, 'needs', { debtId: 'd-card', planId: 'pd-card' }]
    ];
    LAST.forEach(function (r) { add(prev, r[0], r[1], r[2], r[3], r[4]); });
    THIS.forEach(function (r) { add(now, r[0], r[1], r[2], r[3], r[4]); });

    var autos = ['pd-rent', 'pd-xmas', 'pd-car', 'pd-elec', 'pd-phone', 'pd-ins',
                 'pd-stream', 'pd-gym', 'pd-card'];
    var applied = {};
    applied[now] = autos;

    return {
      version: 3,
      settings: { income: 4200, carryover: true, startBalance: 1900, incomeDay: 15 },
      buckets: [
        { id: 'needs', name: 'Needs',    pct: 55, slot: 1, kind: 'spend' },
        { id: 'wants', name: 'Wants',    pct: 20, slot: 2, kind: 'spend' },
        { id: 'bs',    name: 'Bullshit', pct: 5,  slot: 3, kind: 'spend' },
        { id: 'save',  name: 'Savings',  pct: 20, slot: 4, kind: 'save'  }
      ],
      plan: [
        { id: 'pd-rent',   bucketId: 'needs', label: 'Rent',           amount: 1250,  auto: true,  day: 1 },
        { id: 'pd-elec',   bucketId: 'needs', label: 'City Electric',  amount: 122,   auto: true,  day: 6 },
        { id: 'pd-phone',  bucketId: 'needs', label: 'Mobile',         amount: 65,    auto: true,  day: 8 },
        { id: 'pd-ins',    bucketId: 'needs', label: 'Car insurance',  amount: 142,   auto: true,  day: 12 },
        { id: 'pd-food',   bucketId: 'needs', label: 'Groceries',      amount: 400,   auto: false, day: 1 },
        { id: 'pd-gas',    bucketId: 'needs', label: 'Petrol',         amount: 150,   auto: false, day: 1 },
        { id: 'pd-card',   bucketId: 'needs', label: 'Card payment',   amount: 120,   auto: true,  day: 22, debtId: 'd-card' },
        { id: 'pd-stream', bucketId: 'wants', label: 'Streaming',      amount: 34,    auto: true,  day: 18 },
        { id: 'pd-gym',    bucketId: 'wants', label: 'Gym',            amount: 29,    auto: true,  day: 20 },
        { id: 'pd-xmas',   bucketId: 'save',  label: 'Christmas fund', amount: 70.83, auto: true,  day: 2, fundId: 'f-xmas' },
        { id: 'pd-car',    bucketId: 'save',  label: 'Car fund',       amount: 75,    auto: true,  day: 2, fundId: 'f-car' }
      ],
      funds: [
        { id: 'f-xmas', name: 'Christmas', target: 850, every: 12, dueMonth: 12, bucketId: 'save' },
        { id: 'f-car',  name: 'Car repairs', target: 900, every: 12, dueMonth: 0, bucketId: 'save' }
      ],
      debts: [
        { id: 'd-card', name: 'Credit card',  balance: 2400,  apr: 22.9 },
        { id: 'd-loan', name: 'Student loan', balance: 14800, apr: 6.1 }
      ],
      txns: txns,
      applied: applied,
      memory: {
        kroger: 'needs', shell: 'needs', mobile: 'needs', rent: 'needs',
        'city electric': 'needs', 'car insurance': 'needs', dentist: 'needs',
        target: 'wants', amazon: 'wants', streaming: 'wants', gym: 'wants',
        cinema: 'wants', clothes: 'wants', 'thai basil': 'wants',
        doordash: 'bs', 'uber eats': 'bs', starbucks: 'bs', 'overdraft fee': 'bs'
      }
    };
  }

  function inDemo() { return localStorage.getItem(DEMO_KEY) === '1'; }

  /* The real budget is parked, not overwritten, so trying the demo can never
     cost someone the thing they came here with. */
  function enterDemo() {
    try {
      if (!inDemo()) {
        var real = localStorage.getItem(STORE_KEY);
        if (real) localStorage.setItem(PREDEMO_KEY, real);
        localStorage.setItem(DEMO_KEY, '1');
      }
    } catch (e) { /* storage blocked — the demo still runs, just not across reloads */ }
    state = migrate(demoState());
    ui.month = currentYM();
    ui.view = 'dashboard';
    ui.openRows = {};
    ui.lastPost = null;
    ui.undos = [];
    commit();
  }

  function exitDemo() {
    var real = null;
    try {
      real = localStorage.getItem(PREDEMO_KEY);
      localStorage.removeItem(DEMO_KEY);
      localStorage.removeItem(PREDEMO_KEY);
    } catch (e) { /* nothing to restore from */ }

    state = blankState();
    if (real) {
      try { state = migrate(JSON.parse(real)); }
      catch (e) { state = blankState(); }
    }
    ui.month = currentYM();
    ui.view = 'dashboard';
    ui.openRows = {};
    ui.lastPost = null;
    ui.undos = [];
    commit();
    toast(real ? 'Demo cleared — your own numbers are back.' : 'Demo cleared. This is your budget now.');
  }

  /* ---------- derived numbers ---------- */

  function bucket(id) {
    return state.buckets.filter(function (b) { return b.id === id; })[0] || null;
  }

  function pctTotal() {
    return state.buckets.reduce(function (a, b) { return a + num(b.pct); }, 0);
  }

  function allocated(b) {
    return num(state.settings.income) * num(b.pct) / 100;
  }

  function plannedFor(bucketId) {
    return state.plan
      .filter(function (p) { return p.bucketId === bucketId; })
      .reduce(function (a, p) { return a + num(p.amount); }, 0);
  }

  function txnsInMonth(ym) {
    return state.txns.filter(function (t) { return monthOf(t.date) === ym; });
  }

  function isSaving(b) { return b && b.kind === 'save'; }

  /* Consumption and saving are reported separately everywhere. Summing them
     produces the number the old dashboard showed, where transferring $1,353 to
     savings and spending $1,353 on takeaway looked identical. */
  function splitSpend(ym) {
    var consumed = 0, saved = 0;
    txnsInMonth(ym).forEach(function (t) {
      var b = bucket(t.bucketId);
      if (isSaving(b)) saved += num(t.amount);
      else consumed += num(t.amount);
    });
    return { consumed: consumed, saved: saved };
  }

  function spentFor(bucketId, ym) {
    return txnsInMonth(ym)
      .filter(function (t) { return t.bucketId === bucketId; })
      .reduce(function (a, t) { return a + num(t.amount); }, 0);
  }

  /* ---------- net worth ---------- */

  function assetsTotal() {
    return state.assets.reduce(function (a, x) { return a + num(x.value); }, 0);
  }

  /* Owed now, not owed originally — so paying a debt down moves net worth up
     by exactly the amount the Debts screen says you paid off. */
  function debtsTotal() {
    return state.debts.reduce(function (a, d) { return a + debtNow(d); }, 0);
  }

  function netWorth() { return assetsTotal() - debtsTotal(); }

  /* Compound the pile forward, adding the same contribution each year. One
     point per year including today, so the caller can just draw it. */
  function projectWorth(start, annualAdd, ratePct, years) {
    var r = num(ratePct) / 100;
    var pts = [start];
    var v = start;
    for (var i = 1; i <= years; i++) {
      v = v * (1 + r) + num(annualAdd);
      pts.push(v);
    }
    return pts;
  }

  /* ---------- funds ---------- */

  function fund(id) {
    return state.funds.filter(function (f) { return f.id === id; })[0] || null;
  }

  /* Paying into a fund is a charge in a saving bucket; spending out of it is a
     charge in a spending bucket. The balance is the difference, so the Christmas
     presents you actually bought draw down the Christmas money you actually put
     aside, and neither can be recorded without the other noticing. */
  function fundBalance(fundId) {
    return state.txns.reduce(function (a, t) {
      if (t.fundId !== fundId) return a;
      return a + (isSaving(bucket(t.bucketId)) ? num(t.amount) : -num(t.amount));
    }, 0);
  }

  /* What this fund needs every month to be whole by the time it is needed. */
  function fundMonthly(f) {
    var every = num(f.every);
    if (every > 0) return num(f.target) / every;
    return 0;
  }

  function fundsMonthlyTotal() {
    return state.funds.reduce(function (a, f) { return a + fundMonthly(f); }, 0);
  }

  /* ---------- debts ---------- */

  function debtPaid(debtId) {
    return state.txns.reduce(function (a, t) {
      return t.debtId === debtId ? a + num(t.amount) : a;
    }, 0);
  }

  function debtNow(d) { return Math.max(num(d.balance) - debtPaid(d.id), 0); }

  /* What the debt costs if it is paid at this rate and no faster. Returns null
     when the payment cannot outrun the interest — which is the single most
     useful thing this screen can tell someone. */
  function payoff(balance, apr, monthly) {
    if (balance <= 0) return { months: 0, interest: 0 };
    if (monthly <= 0) return null;
    var r = num(apr) / 100 / 12;
    if (r > 0 && monthly <= balance * r) return null;   /* interest outruns the payment */

    /* Walked month by month rather than solved in closed form, because the
       final payment is a partial one — a formula that assumes a full last
       payment overstates the interest, which is the number on display. */
    var bal = balance, interest = 0, n = 0;
    while (bal > 0 && n < 1200) {
      var i = bal * r;
      interest += i;
      bal = bal + i - monthly;
      n++;
    }
    return bal > 0 ? null : { months: n, interest: interest };
  }

  /* Everything the plan sends at this debt every month. */
  function debtMonthly(debtId) {
    return state.plan.reduce(function (a, p) {
      return p.debtId === debtId ? a + num(p.amount) : a;
    }, 0);
  }

  function yearsLabel(months) {
    if (months < 12) return plural(months, 'month', 'months');
    var y = Math.floor(months / 12), m = months % 12;
    return plural(y, 'year', 'years') + (m ? ' ' + plural(m, 'month', 'months') : '');
  }

  /* ---------- carryover ---------- */

  /* Envelope behaviour: a month you overspend leaves you owing yourself, and a
     month you underspend leaves you something. Without this both simply vanish
     at midnight on the 1st and nothing is ever learned. */
  function carryInto(bucketId, ym) {
    if (!state.settings.carryover) return 0;
    var b = bucket(bucketId);
    if (!b || isSaving(b)) return 0;
    var months = monthsWithData().filter(function (m) { return m < ym; });
    return months.reduce(function (a, m) {
      return a + (allocated(b) - spentFor(bucketId, m));
    }, 0);
  }

  function monthsWithData() {
    var seen = {};
    state.txns.forEach(function (t) { if (isYMD(t.date)) seen[monthOf(t.date)] = 1; });
    return Object.keys(seen).sort();
  }

  /* ---------- cash flow ---------- */

  /* Overspending and running out of money are different failures. A month can
     close in the black and still bounce twice, because the rent landed before
     the paycheck did. Walk the days and say where the floor is. */
  function cashFlow(ym) {
    var start = num(state.settings.startBalance);
    if (start <= 0 || ym !== currentYM()) return null;

    var last = daysInMonth(ym);
    var income = num(state.settings.income);
    var payDay = Math.min(Math.max(num(state.settings.incomeDay) || 1, 1), last);

    var byDay = {};
    txnsInMonth(ym).forEach(function (t) {
      var d = Number(t.date.slice(8, 10));
      byDay[d] = (byDay[d] || 0) + num(t.amount);
    });

    /* Regulars that have not posted yet still land this month. */
    var done = state.applied[ym] || [];
    state.plan.forEach(function (p) {
      if (!p.auto || num(p.amount) <= 0) return;
      if (done.indexOf(p.id) !== -1) return;
      var d = Math.min(Math.max(num(p.day) || 1, 1), last);
      byDay[d] = (byDay[d] || 0) + num(p.amount);
    });

    var bal = start, low = start, lowDay = 1, firstNeg = 0;
    for (var d = 1; d <= last; d++) {
      if (d === payDay) bal += income;
      bal -= (byDay[d] || 0);
      if (bal < low) { low = bal; lowDay = d; }
      if (bal < 0 && !firstNeg) firstNeg = d;
    }
    return { end: bal, low: low, lowDay: lowDay, firstNeg: firstNeg, payDay: payDay };
  }

  function monthsPresent() {
    var seen = {};
    state.txns.forEach(function (t) { if (t.date) seen[monthOf(t.date)] = 1; });
    var list = Object.keys(seen);
    if (list.indexOf(ui.month) === -1) list.push(ui.month);
    return list.sort();
  }

  /* ---------- regulars (recurring charges) ---------- */

  /* Post any auto regulars the current month has not seen yet.
     Only ever the current month: scrolling back to March must not fabricate a
     March you never logged, and scrolling forward must not invent a future.
     Each posting is recorded per plan item, so deleting a posted charge does
     not make it reappear on the next render. */
  function postRegulars(ym) {
    if (ym !== currentYM()) return null;

    var done = state.applied[ym] || [];
    /* applied is keyed by plan id, so deleting a regular and re-creating it
       produces an id this month has never seen — and it posts a second time on
       top of the charge already sitting there. Match on what the charge looks
       like as well, not just which row created it. */
    var posted = {};
    txnsInMonth(ym).forEach(function (t) {
      if (t.planId) posted[norm(t.payee) + '|' + t.bucketId] = 1;
    });

    var due = state.plan.filter(function (p) {
      if (!p.auto || num(p.amount) <= 0) return false;
      if (done.indexOf(p.id) !== -1) return false;
      return !posted[norm(p.label) + '|' + p.bucketId];
    });
    if (!due.length) return null;

    var last = daysInMonth(ym);
    var added = [];

    due.forEach(function (p) {
      var t = {
        id: uid(),
        date: ym + '-' + pad(Math.min(Math.max(num(p.day) || 1, 1), last)),
        payee: p.label,
        amount: num(p.amount),
        bucketId: p.bucketId,
        note: 'Regular',
        planId: p.id
      };
      /* A regular that funds a pot or pays down a debt carries that through, so
         posting it moves the fund balance and the debt with it. */
      if (p.fundId) t.fundId = p.fundId;
      if (p.debtId) t.debtId = p.debtId;
      state.txns.push(t);
      added.push(t.id);
    });

    state.applied[ym] = done.concat(due.map(function (p) { return p.id; }));
    save();

    return {
      ym: ym,
      count: due.length,
      total: due.reduce(function (a, p) { return a + num(p.amount); }, 0),
      txnIds: added,
      planIds: due.map(function (p) { return p.id; })
    };
  }

  /* Drop the charges but leave the month marked as applied — otherwise the very
     next render sees them as still due and posts them straight back. "Undo"
     therefore means "not this month", not "pretend it never ran". */
  function undoPost(post) {
    state.txns = state.txns.filter(function (t) { return post.txnIds.indexOf(t.id) === -1; });
    ui.lastPost = null;
    commit();
    toast('Pulled ' + plural(post.count, 'regular', 'regulars') +
      ' back out. They will not post again for ' + monthShort(post.ym) + '.');
  }

  function autoCount() {
    return state.plan.filter(function (p) { return p.auto && num(p.amount) > 0; }).length;
  }

  /* ---------- chart ---------- */

  function donut(rows, centerValue, centerLabel) {
    var total = rows.reduce(function (a, r) { return a + r.value; }, 0);
    var R = 54, SW = 18, C = 2 * Math.PI * R;
    var segs = '';

    if (total > 0) {
      var offset = 0;
      rows.forEach(function (r) {
        if (r.value <= 0) return;
        var len = (r.value / total) * C;
        /* 2px surface gap between adjacent fills */
        var draw = Math.max(len - 2, 0.5);
        segs += '<circle cx="70" cy="70" r="' + R + '" fill="none"' +
          ' stroke="' + r.color + '" stroke-width="' + SW + '"' +
          ' stroke-dasharray="' + draw.toFixed(2) + ' ' + (C - draw).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (-offset).toFixed(2) + '"' +
          ' transform="rotate(-90 70 70)"></circle>';
        offset += len;
      });
    } else {
      segs = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="var(--grid)" stroke-width="' + SW + '"></circle>';
    }

    /* Three light-mode slots sit below 3:1 on the surface, so identity never
       rests on color alone — every series is named and valued right here. */
    var legend = rows.map(function (r) {
      var share = total > 0 ? Math.round((r.value / total) * 100) : 0;
      return '<div class="legend-item">' +
        '<span class="swatch" style="background:' + r.color + '"></span>' +
        '<span>' + esc(r.name) + '</span>' +
        '<span class="spacer"></span>' +
        '<b>' + money0(r.value) + '</b>' +
        '<span style="color:var(--ink-muted);min-width:34px;text-align:right">' + share + '%</span>' +
        '</div>';
    }).join('');

    return '<div class="donut-wrap">' +
      '<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Spending by bucket">' +
      segs +
      '<text x="70" y="68" text-anchor="middle" class="donut-center-1" fill="var(--ink)">' + money0(centerValue) + '</text>' +
      '<text x="70" y="84" text-anchor="middle" class="donut-center-2">' + esc(centerLabel) + '</text>' +
      '</svg>' +
      '<div class="legend">' + legend + '</div>' +
      '</div>';
  }

  /* A plain line chart. Values are named in the labels underneath rather than
     left to the shape of the curve, and the fill is the same series colour as
     everything else so it reads as one system. */
  function lineChart(pts, startAge) {
    var W = 640, H = 190, PL = 6, PR = 6, PT = 12, PB = 26;
    var n = pts.length;
    if (n < 2) return '';

    var lo = Math.min.apply(null, pts.concat([0]));
    var hi = Math.max.apply(null, pts);
    if (hi === lo) hi = lo + 1;

    var x = function (i) { return PL + (i / (n - 1)) * (W - PL - PR); };
    var y = function (v) { return PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB); };

    var line = '', area = '';
    for (var i = 0; i < n; i++) {
      line += (i ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(pts[i]).toFixed(1);
    }
    area = line + ' L' + x(n - 1).toFixed(1) + ' ' + y(Math.max(lo, 0)).toFixed(1) +
           ' L' + x(0).toFixed(1) + ' ' + y(Math.max(lo, 0)).toFixed(1) + ' Z';

    /* A zero line, because a negative net worth is a real place to be and the
       chart should not quietly imply the floor is zero. */
    var zero = (lo < 0 && hi > 0)
      ? '<line x1="' + PL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - PR) +
        '" y2="' + y(0).toFixed(1) + '" stroke="var(--axis)" stroke-width="1" stroke-dasharray="3 3"></line>'
      : '';

    var ticks = '';
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) {
      var lbl = startAge ? 'age ' + (startAge + i) : '+' + i + 'y';
      ticks += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') +
        '" class="chart-tick">' + esc(lbl) + '</text>';
    });

    return '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'role="img" aria-label="Projected net worth over time">' +
      zero +
      '<path d="' + area + '" fill="var(--series-1)" opacity="0.12"></path>' +
      '<path d="' + line + '" fill="none" stroke="var(--series-1)" stroke-width="2.5" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>' +
      ticks +
      '</svg></div>';
  }

  /* ---------- shared bits ---------- */

  function head(title, right) {
    return '<div class="view-head"><h1>' + esc(title) + '</h1>' + (right || '') + '</div>';
  }

  function tile(label, value, note, cls) {
    return '<div class="tile">' +
      '<div class="tile-label">' + esc(label) + '</div>' +
      '<div class="tile-value ' + (cls || '') + '">' + value + '</div>' +
      '<div class="tile-note">' + esc(note) + '</div>' +
      '</div>';
  }

  function monthStepper() {
    return '<div class="stepper">' +
      '<button class="btn btn-sm" data-act="month" data-delta="-1" aria-label="Previous month">‹</button>' +
      '<span class="label">' + esc(monthLabel(ui.month)) + '</span>' +
      '<button class="btn btn-sm" data-act="month" data-delta="1" aria-label="Next month">›</button>' +
      '</div>';
  }

  function bucketOptions(selected) {
    return state.buckets.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === selected ? ' selected' : '') + '>' +
        esc(b.name) + '</option>';
    }).join('');
  }

  /* Two conditions that must outlive a toast, because in both cases the next
     thing the user does can cost them their data. */
  function demoBanner() {
    if (!inDemo()) return '';
    return '<div class="banner banner-demo">' +
      '<span>🧪</span>' +
      '<span><b>This is a made-up household.</b> Poke at anything — your own numbers are safely parked and come straight back.</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="exit-demo">Clear the demo</button>' +
      '</div>';
  }

  /* The one screen that decides whether someone stays. An empty dashboard is a
     blank room; this is the door out of it. */
  function emptyInvite() {
    if (inDemo()) return '';
    if (num(state.settings.income) > 0 || state.txns.length) return '';
    return '<div class="card invite">' +
      '<h2>Nothing here yet</h2>' +
      '<p class="sub">Cense is easier to judge full than empty. Load a made-up household and have a look around — ' +
      'buckets, a Christmas fund that is running late, a card with a rate on it, and an account that dips below zero ' +
      'four days before payday. Nothing is saved until you say so.</p>' +
      '<div class="row">' +
        '<button class="btn btn-primary" data-act="enter-demo">Show me with sample numbers</button>' +
        '<button class="btn" data-act="goto-settings">I will put my own in</button>' +
      '</div>' +
    '</div>';
  }

  function alarmBanners() {
    var out = '';
    if (ui.loadFailed) {
      out += '<div class="note note-warn"><span>⚠</span><span>Cense could not read the budget saved in this browser, so it opened empty. ' +
        '<b>Your data has not been deleted</b> — the unreadable copy is kept under a recovery key. ' +
        'Restore your last export rather than starting over, and do not clear this browser\'s data.</span></div>';
    }
    if (ui.saveFailed) {
      out += '<div class="note note-warn"><span>⚠</span><span><b>Nothing is being saved.</b> This browser refused the last write — storage may be full, ' +
        'or private browsing may be blocking it. Everything on screen will vanish on reload. ' +
        'Use <b>Export backup</b> in Settings now.</span></div>';
    }
    return out;
  }

  /* Deleting a row used to be one unconfirmed click next to an editable field.
     An undo bar beats a confirm dialog here: the common case stays one click,
     and the mistake is recoverable rather than merely slower. */
  /* A stack, not a slot. Deleting a fund and then a debt used to discard the
     first undo silently — and now that both live on one screen, doing exactly
     that is easy.

     Last in, first out is not a preference here, it is required: each undo
     closes over the array index its row came from, so they only splice back
     correctly if unwound in the reverse of the order they were made. */
  var UNDO_MAX = 12;

  function stashUndo(label, fn) {
    ui.undos.push({ label: label, fn: fn });
    while (ui.undos.length > UNDO_MAX) ui.undos.shift();
  }

  function undoBanner() {
    var n = ui.undos.length;
    if (!n) return '';
    var top = ui.undos[n - 1];
    return '<div class="banner">' +
      '<span>🗑</span><span>' + esc(top.label) + '</span>' +
      (n > 1 ? '<span class="hint">' + (n - 1) + ' more can be undone</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="undo-delete">Undo</button>' +
      '<button class="btn-icon" data-act="dismiss-undo" aria-label="Dismiss" title="Dismiss">✕</button>' +
      '</div>';
  }

  /* Funds and debts are both "this money is going somewhere specific", so they
     share one control rather than two competing columns. */
  function hasToward() { return state.funds.length > 0 || state.debts.length > 0; }

  function towardValue(item) {
    if (item.fundId) return 'fund:' + item.fundId;
    if (item.debtId) return 'debt:' + item.debtId;
    return '';
  }

  function towardOptions(sel) {
    var out = '<option value="">—</option>';
    if (state.funds.length) {
      out += '<optgroup label="Funds">' + state.funds.map(function (f) {
        var v = 'fund:' + f.id;
        return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(f.name) + '</option>';
      }).join('') + '</optgroup>';
    }
    if (state.debts.length) {
      out += '<optgroup label="Debts">' + state.debts.map(function (d) {
        var v = 'debt:' + d.id;
        return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(d.name) + '</option>';
      }).join('') + '</optgroup>';
    }
    return out;
  }

  function setToward(item, v) {
    delete item.fundId;
    delete item.debtId;
    if (v.indexOf('fund:') === 0) item.fundId = v.slice(5);
    else if (v.indexOf('debt:') === 0) item.debtId = v.slice(5);
  }

  function postBanner() {
    var p = ui.lastPost;
    if (!p || p.ym !== ui.month) return '';
    return '<div class="banner">' +
      '<span>🔁</span>' +
      '<span>Posted ' + plural(p.count, 'regular', 'regulars') + ' for ' + esc(monthShort(p.ym)) +
      ' — <b>' + money(p.total) + '</b>.</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="undo-post">Undo</button>' +
      '</div>';
  }

  /* ---------- dashboard ---------- */

  function viewDashboard() {
    var income = num(state.settings.income);
    var ym = ui.month;
    var split = splitSpend(ym);
    var left = income - split.consumed - split.saved;
    var pt = pctTotal();

    var notes = '';
    if (income <= 0) {
      notes += '<div class="note"><span>👋</span><span>Tell Cense what you make in <b>Settings</b> and the buckets come to life.</span></div>';
    }
    if (Math.abs(pt - 100) > 0.01) {
      notes += '<div class="note note-warn"><span>⚠</span><span>Your buckets add up to <b>' + pt + '%</b>, not 100%. ' +
        (pt > 100 ? 'That is more money than you actually make.' : 'Some of your paycheck has nowhere to go.') +
        ' Fix it in <b>Settings</b>.</span></div>';
    }

    /* "Where it went" means consumed. Savings has its own tile — putting it in
       the donut would file the money you kept next to the money you spent. */
    var chartRows = state.buckets.filter(function (b) { return !isSaving(b); }).map(function (b) {
      return { name: b.name, value: spentFor(b.id, ym), color: slotCss(b.slot) };
    });

    var savedPct = income > 0 ? Math.round((split.saved / income) * 100) + '% of your income' : 'this month';

    var tiles =
      tile('Money in', money(income), 'every month') +
      tile('Money out', money(split.consumed), monthShort(ym) + ' — spent, not saved') +
      tile('Saved', money(split.saved), savedPct, split.saved > 0 ? 'pos' : '') +
      tile(left >= 0 ? 'Still yours' : 'In the hole',
           money(Math.abs(left)),
           left >= 0 ? 'not yet spoken for' : 'past the line',
           left >= 0 ? 'pos' : 'neg');

    var buckets = state.buckets.map(function (b) {
      var base = allocated(b);
      var carry = carryInto(b.id, ym);
      var alloc = base + carry;                 /* what is really available */
      var spent = spentFor(b.id, ym);
      var planned = plannedFor(b.id);
      var bLeft = alloc - spent;
      var fill = alloc > 0 ? Math.min(spent / alloc, 1) * 100 : 0;
      var over = alloc > 0 && spent > alloc;

      return '<div class="bucket">' +
        '<div class="bucket-top">' +
          '<span class="bucket-name">' +
            '<span class="swatch" style="background:' + slotCss(b.slot) + '"></span>' +
            esc(b.name) + '<span class="hint">' + num(b.pct) + '%</span>' +
          '</span>' +
          '<span class="bucket-nums">' +
            money0(spent) + ' of ' + money0(alloc) +
            ' &middot; <span class="' + (bLeft >= 0 ? 'pos' : 'neg') + '">' +
              money0(Math.abs(bLeft)) + (bLeft >= 0 ? ' left' : ' over') +
            '</span>' +
          '</span>' +
        '</div>' +
        '<div class="meter">' +
          '<div class="meter-fill" style="width:' + fill.toFixed(1) + '%;background:' +
            (over ? 'var(--critical)' : slotCss(b.slot)) + '"></div>' +
        '</div>' +
        '<div class="hint" style="margin-top:5px">' +
          (Math.abs(carry) >= 0.5
            ? '<span class="' + (carry >= 0 ? 'pos' : 'neg') + '">' + money0(Math.abs(carry)) +
              (carry >= 0 ? ' carried in' : ' owed from before') + '</span> &middot; '
            : '') +
          money0(planned) + ' committed to regulars &middot; ' +
          money0(alloc - planned) + ' still unspoken for</div>' +
      '</div>';
    }).join('');

    var flow = cashFlow(ym);
    var flowNote = '';
    if (flow && flow.firstNeg) {
      flowNote = '<div class="note note-warn"><span>⚠</span><span>On current timing you go below zero on the ' +
        '<b>' + flow.firstNeg + Ordinal(flow.firstNeg) + '</b>, bottoming out at <b>' + money(flow.low) + '</b>. ' +
        'The month still ends at ' + money(flow.end) + ' — this is a timing problem, not an overspending one, ' +
        'and it is what overdraft fees are made of.</span></div>';
    } else if (flow && flow.low < 100) {
      flowNote = '<div class="note"><span>👀</span><span>Tightest point this month is <b>' + money(flow.low) +
        '</b> on the ' + flow.lowDay + Ordinal(flow.lowDay) + '.</span></div>';
    }

    /* debtNow, not d.balance — the latter is what was owed when you first told
       Cense about it, so this card used to sit at the opening figure forever
       while Debts and Net worth both counted down. Three screens, two answers. */
    var debtTotal = debtsTotal();

    return head('Dashboard', monthStepper()) +
      '<p class="sub">' + esc(monthShort(ym)) + ' so far. The honest version.</p>' +
      emptyInvite() + flowNote + notes +
      '<div class="grid grid-4" style="margin-bottom:16px">' + tiles + '</div>' +
      '<div class="grid grid-2">' +
        '<div class="card"><h2>Your buckets</h2>' + buckets + '</div>' +
        '<div>' +
          '<div class="card"><h2>Where it went</h2>' + donut(chartRows, split.consumed, 'spent') + '</div>' +
          (state.debts.length
            ? '<div class="card"><h2>Still owed</h2>' +
              '<div class="tile-value">' + money(debtTotal) + '</div>' +
              '<div class="tile-note">across ' + plural(state.debts.length, 'balance', 'balances') + '</div></div>'
            : '') +
        '</div>' +
      '</div>';
  }

  /* ---------- spending ---------- */

  /* Today if we are on the current month, otherwise a sane day inside the one
     being viewed. Clamped so the 31st never yields "2026-02-31". */
  function defaultEntryDate() {
    var today = todayISO();
    if (monthOf(today) === ui.month) return today;
    return ui.month + '-' + pad(Math.min(new Date().getDate(), daysInMonth(ui.month)));
  }

  function viewTransactions() {
    var ym = ui.month;
    var q = norm(ui.search);
    var rows = txnsInMonth(ym).filter(function (t) {
      return !q || norm(t.payee).indexOf(q) !== -1 || norm(t.note).indexOf(q) !== -1;
    });
    rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var total = rows.reduce(function (a, t) { return a + num(t.amount); }, 0);
    var toward = hasToward();

    var body = rows.map(function (t) {
      var tid = esc(t.id);
      var open = !!ui.openRows[t.id];
      return '<tr' + (open ? ' class="open"' : '') + '>' +
        '<td data-label="Date" style="width:132px"><input class="inp" type="date" value="' + esc(t.date) + '" data-id="' + tid + '" data-field="date"></td>' +
        '<td data-label="Charge"><input class="inp" value="' + esc(t.payee) + '" data-id="' + tid + '" data-field="payee" placeholder="Who got the money"></td>' +
        '<td data-label="Amount" style="width:110px"><input class="inp num" value="' + num(t.amount).toFixed(2) + '" data-id="' + tid + '" data-field="amount" inputmode="decimal"></td>' +
        '<td data-label="Bucket" style="width:132px"><select class="inp" data-id="' + tid + '" data-field="bucketId">' + bucketOptions(t.bucketId) + '</select></td>' +
        '<td data-label="Note"><input class="inp" value="' + esc(t.note) + '" data-id="' + tid + '" data-field="note" placeholder="—"></td>' +
        (toward
          ? '<td data-label="Toward" style="width:132px"><select class="inp" data-id="' + tid + '" data-field="toward" title="Put this toward a fund or a debt">' +
            towardOptions(towardValue(t)) + '</select></td>'
          : '') +
        '<td class="td-act" style="width:34px">' +
          '<button class="btn-more" data-act="toggle-row" data-id="' + tid + '"' +
            ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
            ' aria-label="' + (open ? 'Fewer fields for ' : 'More fields for ') + esc(t.payee || 'this charge') + '">' +
            (open ? '⌃' : '⌄') + '</button>' +
          '<button class="btn-icon" data-act="del-txn" data-id="' + tid + '" aria-label="Delete" title="Delete">✕</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    var table = rows.length
      ? '<div class="table-wrap"><table class="stack">' +
          '<thead><tr><th>Date</th><th>Charge</th><th class="num">Amount</th><th>Bucket</th><th>Note</th>' +
            (toward ? '<th>Toward</th>' : '') + '<th></th></tr></thead>' +
          '<tbody>' + body + '</tbody>' +
          '<tfoot><tr><td></td><td data-label="Showing">' + plural(rows.length, 'charge', 'charges') + '</td>' +
            '<td class="num" data-label="Total">' + money(total) + '</td><td colspan="' + (toward ? 4 : 3) + '"></td></tr></tfoot>' +
        '</table></div>'
      : '<div class="empty">' +
        (ui.search
          ? 'Nothing matching “' + esc(ui.search) + '” in ' + esc(monthShort(ym)) + '.'
          : 'Clean slate for ' + esc(monthShort(ym)) + '. Add the first one above.') +
        '</div>';

    var addForm =
      '<div class="card">' +
        '<h2>What did you buy?</h2>' +
        '<div class="row">' +
          '<input class="inp bordered" id="f-date" type="date" value="' + esc(defaultEntryDate()) + '" style="width:152px">' +
          '<input class="inp bordered" id="f-payee" placeholder="Charge (e.g. HEB)" style="flex:2;min-width:150px">' +
          '<input class="inp num bordered" id="f-amount" placeholder="0.00" inputmode="decimal" style="width:110px">' +
          '<select class="inp bordered" id="f-bucket" style="width:142px">' + bucketOptions(state.buckets[0] && state.buckets[0].id) + '</select>' +
          '<input class="inp bordered" id="f-note" placeholder="Note (optional)" style="flex:1;min-width:130px">' +
          '<button class="btn btn-primary" data-act="add-txn">Add it</button>' +
        '</div>' +
        '<div class="hint" style="margin-top:8px">Cense guesses the bucket from charges you have filed before. Hit Enter to save.</div>' +
      '</div>';

    var toolbar =
      '<div class="row" style="margin-bottom:14px">' + monthStepper() +
        '<span class="spacer"></span>' +
        '<input class="inp bordered" id="f-search" placeholder="Search…" value="' + esc(ui.search) + '" style="width:190px">' +
        '<button class="btn" data-act="import-csv">Import CSV</button>' +
      '</div>';

    return head('Spending') +
      '<p class="sub">Every charge, in one place, with nowhere to hide.</p>' +
      toolbar + addForm + '<div class="card">' + table + '</div>';
  }

  /* ---------- regulars ---------- */

  function viewRegulars() {
    var income = num(state.settings.income);
    var autoOn = autoCount();
    var toward = hasToward();

    var sections = state.buckets.map(function (b) {
      var items = state.plan.filter(function (p) { return p.bucketId === b.id; });
      var planned = plannedFor(b.id);
      var alloc = allocated(b);
      var left = alloc - planned;

      var rows = items.map(function (p) {
        var pid = esc(p.id);
        return '<tr>' +
          '<td data-label="Charge"><input class="inp" value="' + esc(p.label) + '" data-id="' + pid + '" data-field="label" data-kind="plan" placeholder="What is it"></td>' +
          '<td data-label="Amount" style="width:112px"><input class="inp num" value="' + num(p.amount).toFixed(2) + '" data-id="' + pid + '" data-field="amount" data-kind="plan" inputmode="decimal"></td>' +
          '<td data-label="Day" style="width:86px"><input class="inp num" value="' + (num(p.day) || 1) + '" data-id="' + pid + '" data-field="day" data-kind="plan" inputmode="numeric" title="Day of the month it hits (1–31)"></td>' +
          (toward
            ? '<td data-label="Toward" style="width:130px"><select class="inp" data-id="' + pid + '" data-field="toward" data-kind="plan" title="Point this payment at a fund or a debt">' +
              towardOptions(towardValue(p)) + '</select></td>'
            : '') +
          '<td data-label="Auto" style="width:60px">' +
            '<label class="switch" title="Post this automatically every month">' +
              '<input type="checkbox"' + (p.auto ? ' checked' : '') + ' data-id="' + pid + '" data-field="auto" data-kind="plan">' +
              '<span class="switch-track"></span>' +
            '</label>' +
          '</td>' +
          '<td style="width:34px"><button class="btn-icon" data-act="del-plan" data-id="' + pid + '" aria-label="Delete" title="Delete">✕</button></td>' +
          '</tr>';
      }).join('');

      return '<div class="card">' +
        '<div class="bucket-top" style="margin-bottom:4px">' +
          '<span class="bucket-name">' +
            '<span class="swatch" style="background:' + slotCss(b.slot) + '"></span>' + esc(b.name) +
          '</span>' +
          '<span class="bucket-nums">' + money0(planned) + ' of ' + money0(alloc) +
            ' &middot; <span class="' + (left >= 0 ? 'pos' : 'neg') + '">' + money0(Math.abs(left)) +
            (left >= 0 ? ' spare' : ' overcommitted') + '</span></span>' +
        '</div>' +
        (BLURBS[b.id] ? '<div class="bucket-blurb" style="margin-bottom:10px">' + esc(BLURBS[b.id]) + '</div>' : '<div style="height:8px"></div>') +
        (items.length
          ? '<div class="table-wrap"><table class="stack">' +
              '<thead><tr><th>Charge</th><th class="num">Amount</th><th class="num">Day</th>' +
                (toward ? '<th>Toward</th>' : '') + '<th>Auto</th><th></th></tr></thead>' +
              '<tbody>' + rows + '</tbody></table></div>'
          : '<div class="empty" style="padding:16px">Nothing on repeat here yet.</div>') +
        '<div class="row" style="margin-top:10px">' +
          '<input class="inp bordered" placeholder="e.g. Rent" data-plan-label="' + esc(b.id) + '" style="flex:2;min-width:150px">' +
          '<input class="inp num bordered" placeholder="0.00" inputmode="decimal" data-plan-amount="' + esc(b.id) + '" style="width:110px">' +
          '<button class="btn btn-sm" data-act="add-plan" data-bucket="' + esc(b.id) + '">Add</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var totalPlanned = state.plan.reduce(function (a, p) { return a + num(p.amount); }, 0);

    return head('The Regulars',
        '<span class="pill' + (autoOn ? ' pill-on' : '') + '">🔁 ' + plural(autoOn, 'on autopilot', 'on autopilot') + '</span>') +
      '<p class="sub">Rent, the electric bill, the streaming service you forgot you had. Set them once and Cense posts them for you at the start of every month — flip <b>Auto</b> off for the ones that change too much to predict.</p>' +
      '<div class="note"><span>💡</span><span>Committing <b>' + money(totalPlanned) + '</b> of your ' +
        money(income) + ' a month. Anything with Auto on lands in <b>Spending</b> automatically; the rest is just your plan on paper.</span></div>' +
      sections;
  }

  /* ---------- toward: funds and debts ---------- */

  /* One screen, because the app already treats these as one thing: a single
     Toward control writes both, one hasToward() decides whether either exists,
     and their balances are the same reduce over txns with a different tag.
     Regulars is what leaves every month; this is what it is leaving toward. */
  function viewToward() {
    var saved = state.funds.reduce(function (a, f) { return a + Math.max(fundBalance(f.id), 0); }, 0);
    var owed = debtsTotal();
    var nothingYet = !state.funds.length && !state.debts.length;

    var pills = '<span class="row" style="gap:6px">' +
      (state.funds.length ? '<span class="pill pill-on">🪺 ' + money0(saved) + ' set aside</span>' : '') +
      (state.debts.length ? '<span class="pill">' + money0(owed) + ' owed</span>' : '') +
      '</span>';

    return head('Toward', pills) +
      '<p class="sub">Funds you are filling and debts you are emptying. Point a regular at any of them in <b>Regulars</b> and it moves on its own.</p>' +
      (nothingYet
        ? '<div class="card"><div class="empty">Nothing here yet. A <b>fund</b> is money set aside for something that is not monthly — Christmas, tyres, the insurance renewal. A <b>debt</b> is the other direction.</div></div>'
        : '') +
      fundsSection(nothingYet) +
      debtsSection(nothingYet);
  }

  /* ---------- net worth ---------- */

  function viewWorth() {
    var assets = assetsTotal();
    var owed = debtsTotal();
    var worth = assets - owed;
    var age = num(state.settings.age);
    var band = bandForAge(age);

    var byKind = ASSET_KINDS.map(function (k) {
      var items = state.assets.filter(function (a) { return a.kind === k.id; });
      return { kind: k, total: items.reduce(function (a, x) { return a + num(x.value); }, 0), count: items.length };
    }).filter(function (r) { return r.count > 0; });

    var rows = state.assets.map(function (a) {
      var aid = esc(a.id);
      return '<tr>' +
        '<td data-label="What it is"><input class="inp" value="' + esc(a.name) + '" data-id="' + aid + '" data-field="name" data-kind="asset" placeholder="e.g. 401(k)"></td>' +
        '<td data-label="Type" style="width:150px"><select class="inp" data-id="' + aid + '" data-field="kind" data-kind="asset">' +
          ASSET_KINDS.map(function (k) {
            return '<option value="' + k.id + '"' + (k.id === a.kind ? ' selected' : '') + '>' + esc(k.name) + '</option>';
          }).join('') +
        '</select></td>' +
        '<td data-label="Worth" style="width:150px"><input class="inp num" value="' + num(a.value).toFixed(2) + '" data-id="' + aid + '" data-field="value" data-kind="asset" inputmode="decimal"></td>' +
        '<td class="td-act" style="width:34px"><button class="btn-icon" data-act="del-asset" data-id="' + aid + '" aria-label="Delete" title="Delete">✕</button></td>' +
        '</tr>';
    }).join('');

    /* ---- where you sit ---- */
    var compare;
    if (!band) {
      compare = '<div class="card">' +
        '<h2>How you compare</h2>' +
        '<p class="sub" style="margin-bottom:12px">Put your age in below and Cense will show the typical net worth for people in your bracket. It is optional and it stays on this device like everything else.</p>' +
        '<label class="field" style="max-width:150px"><span>Your age</span>' +
          '<input class="inp num bordered" id="s-age" value="" placeholder="optional" inputmode="numeric"></label>' +
      '</div>';
    } else {
      var med = band.median;
      var ratio = med > 0 ? worth / med : 0;
      /* The marker is placed on a scale that runs to twice the median, so the
         midpoint of the bar is the typical person rather than an arbitrary top. */
      var pos = Math.max(Math.min(ratio / 2, 1), 0) * 100;
      var ahead = worth >= med;

      compare =
        '<div class="card">' +
          '<h2>How you compare</h2>' +
          '<div class="bucket-top">' +
            '<span class="bucket-name">You &middot; ' + esc(band.label) + '</span>' +
            '<span class="bucket-nums"><b>' + money0(worth) + '</b> vs a typical ' +
              money0(med) + '</span>' +
          '</div>' +
          '<div class="scale">' +
            '<div class="scale-median" style="left:50%"></div>' +
            '<div class="scale-you" style="left:' + pos.toFixed(1) + '%;background:' +
              (ahead ? 'var(--series-4)' : 'var(--series-1)') + '"></div>' +
          '</div>' +
          '<div class="scale-legend"><span>$0</span><span>typical ' + money0(med) + '</span><span>' + money0(med * 2) + '+</span></div>' +
          '<div class="hint" style="margin-top:12px">' +
            (worth >= med
              ? 'You are <b class="pos">' + money0(worth - med) + ' above</b> the median for ' + esc(band.label) + '.'
              : 'You are <b>' + money0(med - worth) + '</b> below the median for ' + esc(band.label) + '. ' +
                'The median is the middle, not a target — half of households sit below it by definition.') +
          '</div>' +
          '<div class="hint" style="margin-top:8px">The <b>mean</b> for this bracket is ' + money0(band.mean) +
            ', but that is not the typical person: a small number of very large fortunes pull it up, ' +
            'and far more than half of households sit below it. The median is the middle.</div>' +
          '<div class="row" style="margin-top:12px">' +
            '<label class="field" style="margin:0;max-width:130px"><span>Your age</span>' +
              '<input class="inp num bordered" id="s-age" value="' + age + '" inputmode="numeric"></label>' +
            '<span class="spacer"></span>' +
            '<button class="btn btn-sm" data-act="clear-age">Stop comparing</button>' +
          '</div>' +
          '<div class="hint" style="margin-top:10px">Source: Federal Reserve <b>Survey of Consumer Finances, ' + SCF.year + '</b> — ' +
            'the most recent published. It reports six age bands and no finer, so there is no such thing as an ' +
            'average for a single year of age. Figures are per household, not per person.</div>' +
        '</div>';
    }

    /* ---- projection ---- */
    var rate = num(state.settings.returnPct);
    var add = num(state.settings.annualAdd);
    /* Thirty years by default, but never past 100 — projecting an 85-year-old
       out to 115 is arithmetic nobody asked for. */
    var years = age ? Math.min(30, Math.max(100 - age, 5)) : 30;
    var pts = projectWorth(worth, add, rate, years);
    var end = pts[pts.length - 1];

    return head('Net worth',
        '<span class="pill' + (worth >= 0 ? ' pill-on' : '') + '">' + money0(worth) + '</span>') +
      '<p class="sub">Everything you own, minus everything you owe. The debts come straight from the <b>Debts</b> screen, so paying one down moves this number on its own.</p>' +

      '<div class="grid grid-4" style="margin-bottom:16px">' +
        tile('Assets', money(assets), plural(state.assets.length, 'thing', 'things')) +
        tile('Owed', money(owed), plural(state.debts.length, 'debt', 'debts')) +
        tile(worth >= 0 ? 'Net worth' : 'Underwater', money(Math.abs(worth)),
             worth >= 0 ? 'what is actually yours' : 'owed beyond what you own',
             worth >= 0 ? 'pos' : 'neg') +
      '</div>' +

      compare +

      '<div class="card">' +
        '<h2>What you own</h2>' +
        (state.assets.length
          ? '<div class="table-wrap"><table class="stack">' +
              '<thead><tr><th>What it is</th><th>Type</th><th class="num">Worth</th><th></th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
              '<tfoot><tr><td></td><td data-label="Total">Total</td><td class="num" data-label="Total">' + money(assets) + '</td><td></td></tr></tfoot>' +
            '</table></div>'
          : '<div class="empty">Nothing listed yet. Retirement accounts and a home are where most of it usually sits.</div>') +
        '<div class="row" style="margin-top:12px">' +
          '<input class="inp bordered" id="a-name" placeholder="e.g. 401(k)" style="flex:2;min-width:150px">' +
          '<select class="inp bordered" id="a-kind" style="width:150px">' +
            ASSET_KINDS.map(function (k) { return '<option value="' + k.id + '">' + esc(k.name) + '</option>'; }).join('') +
          '</select>' +
          '<input class="inp num bordered" id="a-value" placeholder="0.00" inputmode="decimal" style="width:140px">' +
          '<button class="btn btn-primary" data-act="add-asset">Add</button>' +
        '</div>' +
        '<div class="hint" style="margin-top:8px">Put property in at what it would sell for, and leave the mortgage on the <b>Debts</b> screen — listing both is how the two sides stay honest.</div>' +
      '</div>' +

      (byKind.length
        ? '<div class="card"><h2>What it is made of</h2>' +
          /* Slot comes from the kind's fixed position, not the filtered index —
             otherwise Property changes colour the moment you add a Cash row,
             which is exactly the cycling the palette rules forbid. */
          donut(byKind.map(function (r) {
            var slot = 1;
            ASSET_KINDS.forEach(function (k, i) { if (k.id === r.kind.id) slot = i + 1; });
            return { name: r.kind.name, value: r.total, color: slotCss(slot) };
          }), assets, 'in assets') + '</div>'
        : '') +

      '<div class="card">' +
        '<h2>Where it goes from here</h2>' +
        '<p class="sub" style="margin-bottom:14px">Your net worth today, growing at the rate you set, with what you add each year. It is arithmetic, not a forecast — markets do not return the same number every year, and this pretends they do.</p>' +
        '<div class="row" style="margin-bottom:14px">' +
          '<label class="field" style="margin:0"><span>Annual return %</span>' +
            '<input class="inp num bordered" id="s-return" value="' + rate + '" inputmode="decimal" style="width:110px"></label>' +
          '<label class="field" style="margin:0"><span>Added per year</span>' +
            '<input class="inp num bordered" id="s-annualadd" value="' + add.toFixed(2) + '" inputmode="decimal" style="width:140px"></label>' +
          '<span class="spacer"></span>' +
          '<span class="bucket-nums">In ' + years + ' years: <b>' + money0(end) + '</b></span>' +
        '</div>' +
        lineChart(pts, age || 0) +
        '<div class="hint" style="margin-top:10px">' +
          (add <= 0
            ? 'Adding nothing each year, this is just what today\'s pile does on its own.'
            : 'Of that ' + money0(end) + ', <b>' + money0(add * years) + '</b> is money you put in and the rest is growth.') +
        '</div>' +
      '</div>';
  }

  /* ---------- funds ---------- */

  function fundsSection(quiet) {
    var monthlyTotal = fundsMonthlyTotal();
    var income = num(state.settings.income);
    var saveBucket = state.buckets.filter(isSaving)[0];

    var cards = state.funds.map(function (f) {
      var fid = esc(f.id);
      var bal = fundBalance(f.id);
      var target = num(f.target);
      var monthly = fundMonthly(f);
      var pct = target > 0 ? Math.max(Math.min(bal / target, 1), 0) * 100 : 0;
      var short = target - bal;
      var slot = saveBucket ? saveBucket.slot : 4;

      var pledged = fundPledged(f.id);
      var due = f.dueMonth
        ? 'due ' + MONTHS[f.dueMonth - 1]
        : (f.every ? 'whenever it happens' : 'no schedule');

      /* How many months of contributions are still missing when the bill lands. */
      var warn = '';
      /* Spending more out of a pot than was ever put in is exactly the thing
         funds exist to reveal, so it gets said out loud rather than shown as
         a bar stuck at zero. */
      if (bal < -0.5) {
        warn = '<div class="hint neg" style="margin-top:6px">Overdrawn by ' + money(-bal) +
          ' — more has been spent against this than was ever set aside. That money came out of the month instead.</div>';
      } else if (f.dueMonth && monthly > 0 && short > 0) {
        var nowM = Number(currentYM().slice(5, 7));
        var monthsLeft = (f.dueMonth - nowM + 12) % 12;
        var willHave = bal + monthly * monthsLeft;
        if (willHave < target - 0.5) {
          warn = '<div class="hint neg" style="margin-top:6px">At ' + money0(monthly) + ' a month you reach ' +
            money0(willHave) + ' by ' + MONTHS[f.dueMonth - 1] + ' — ' + money0(target - willHave) + ' short.</div>';
        }
      }

      return '<div class="card">' +
        '<div class="bucket-top">' +
          '<span class="bucket-name">' +
            '<span class="swatch" style="background:' + slotCss(slot) + '"></span>' +
            '<input class="inp" value="' + esc(f.name) + '" data-id="' + fid + '" data-field="name" data-kind="fund" style="font-weight:650;max-width:190px">' +
          '</span>' +
          '<span class="bucket-nums"><b>' + money(bal) + '</b> of ' + money(target) +
            ' &middot; ' + Math.round(pct) + '%</span>' +
        '</div>' +
        '<div class="meter" style="margin-top:8px">' +
          '<div class="meter-fill" style="width:' + pct.toFixed(1) + '%;background:' + slotCss(slot) + '"></div>' +
        '</div>' +
        warn +
        '<div class="row" style="margin-top:12px">' +
          '<label class="field" style="margin:0"><span>Target</span>' +
            '<input class="inp num bordered" value="' + target.toFixed(2) + '" data-id="' + fid + '" data-field="target" data-kind="fund" inputmode="decimal" style="width:110px"></label>' +
          '<label class="field" style="margin:0"><span>Every (months)</span>' +
            '<input class="inp num bordered" value="' + num(f.every) + '" data-id="' + fid + '" data-field="every" data-kind="fund" inputmode="numeric" style="width:92px"></label>' +
          '<label class="field" style="margin:0"><span>Needed in</span>' +
            '<select class="inp bordered" data-id="' + fid + '" data-field="dueMonth" data-kind="fund" style="width:132px">' +
              '<option value="0"' + (!f.dueMonth ? ' selected' : '') + '>No fixed month</option>' +
              MONTHS.map(function (m, i) {
                return '<option value="' + (i + 1) + '"' + (f.dueMonth === i + 1 ? ' selected' : '') + '>' + m + '</option>';
              }).join('') +
            '</select></label>' +
          '<span class="spacer"></span>' +
          '<button class="btn-icon" data-act="del-fund" data-id="' + fid + '" aria-label="Delete" title="Delete">✕</button>' +
        '</div>' +
        '<div class="hint">' +
          (monthly > 0
            ? 'Puts <b>' + money(monthly) + '</b> a month aside &middot; ' + esc(due)
            : 'Set a target and a cycle and Cense works out the monthly figure.') +
          (pledged >= monthly - 0.005 && monthly > 0
            ? ' &middot; <span class="pos">transfer set up</span>'
            : pledged > 0
              ? ' &middot; <span class="neg">only ' + money(pledged) + ' of that is set up</span>'
              : '') +
        '</div>' +
        (monthly > 0 && pledged < monthly - 0.005 && saveBucket
          ? '<div class="row" style="margin-top:10px"><button class="btn btn-sm" data-act="fund-plan" data-id="' + fid + '">' +
            (pledged > 0 ? 'Top the transfer up to ' + money(monthly) : 'Set up the ' + money(monthly) + ' monthly transfer') +
            '</button></div>'
          : '') +
      '</div>';
    }).join('');

    return '<h2 class="section-title">Funds</h2>' +
      '<p class="sub">Christmas, the next set of tyres, the insurance renewal. They are not surprises — they are bills you have not started paying yet. Give each one a target and a cycle and Cense spreads it over the months instead of letting it land on one.</p>' +
      (!saveBucket && state.funds.length
        ? '<div class="note note-warn"><span>⚠</span><span>No bucket is marked <b>Saving</b>, so there is nowhere for this money to sit. Set one in <b>Settings</b>.</span></div>'
        : '') +
      (state.funds.length
        ? '<div class="note"><span>💡</span><span>Together these need <b>' + money(monthlyTotal) + '</b> a month' +
          (income > 0 ? ' — ' + Math.round((monthlyTotal / income) * 100) + '% of your income' : '') +
          '. Spend out of a fund by tagging the charge to it in <b>Spending</b>.</span></div>'
        : '') +
      cards +
      '<div class="card">' +
        '<h2>' + (state.funds.length ? 'New fund' : 'Start a fund') + '</h2>' +
        (quiet ? '<p class="sub" style="margin-bottom:12px">Most people need Christmas and car repairs before anything else.</p>' : '') +
        '<div class="row">' +
          '<input class="inp bordered" id="fund-name" placeholder="e.g. Christmas" style="flex:2;min-width:150px">' +
          '<input class="inp num bordered" id="fund-target" placeholder="Target" inputmode="decimal" style="width:120px">' +
          '<input class="inp num bordered" id="fund-every" placeholder="Every N months" inputmode="numeric" style="width:130px">' +
          '<button class="btn btn-primary" data-act="add-fund">Add</button>' +
        '</div>' +
      '</div>';
  }

  function planForFund(fundId) {
    return state.plan.filter(function (p) { return p.fundId === fundId; })[0] || null;
  }

  /* What the plan actually sends this fund each month. Checking merely that a
     regular exists let a $5 transfer against a $70.83 target report itself as
     handled — the debts side has summed the plan properly all along. */
  function fundPledged(fundId) {
    return state.plan.reduce(function (a, p) {
      return p.fundId === fundId ? a + num(p.amount) : a;
    }, 0);
  }

  /* ---------- debts ---------- */

  function debtsSection(quiet) {
    var total = state.debts.reduce(function (a, d) { return a + debtNow(d); }, 0);
    var opening = state.debts.reduce(function (a, d) { return a + num(d.balance); }, 0);
    var paidAll = opening - total;

    var cards = state.debts.map(function (d) {
      var did = esc(d.id);
      var now = debtNow(d);
      var paid = debtPaid(d.id);
      var monthly = debtMonthly(d.id);
      var apr = num(d.apr);
      var proj = payoff(now, apr, monthly);
      var gone = now <= 0;

      /* The point of the interest figure is not precision, it is the size of
         the number. Someone who has never seen it does not know it is there. */
      var verdict;
      if (gone) {
        verdict = '<span class="pos">Paid off. That is one gone.</span>';
      } else if (!monthly) {
        verdict = 'Nothing in the plan is pointed at this yet. Add a regular in <b>Regulars</b> and set its <b>Toward</b> to this debt.';
      } else if (!apr) {
        verdict = 'Paying <b>' + money(monthly) + '</b> a month. Add the interest rate to see what it is costing you.';
      } else if (!proj) {
        verdict = '<span class="neg">At <b>' + money(monthly) + '</b> a month this never gets paid off</span> — the interest at ' +
          apr + '% is ' + money(now * apr / 100 / 12) + ' a month, more than the payment. It grows from here.';
      } else {
        verdict = 'At <b>' + money(monthly) + '</b> a month: clear in <b>' + yearsLabel(proj.months) + '</b>, ' +
          'and the interest costs you <b class="neg">' + money(proj.interest) + '</b> on the way.';
      }

      /* Privacy mode: the payoff sentence never prints a balance, but the rate,
         the term and the literal "$50" in the nudge are three knowns against
         two unknowns — the balance and the payment both fall out with a bit of
         algebra. So the whole projection goes behind the mask with them. */
      if (hideMoney) verdict = 'Payoff details hidden.';

      /* What one more useful step would buy. */
      var nudge = '';
      if (!hideMoney && !gone && apr > 0 && monthly > 0 && proj) {
        var faster = payoff(now, apr, monthly + 50);
        if (faster && faster.interest < proj.interest - 1) {
          nudge = '<div class="hint" style="margin-top:6px">Another <b>$50</b> a month clears it ' +
            yearsLabel(proj.months - faster.months) + ' sooner and saves <b class="pos">' +
            money(proj.interest - faster.interest) + '</b> in interest.</div>';
        }
      }

      var pct = num(d.balance) > 0 ? Math.max(Math.min(paid / num(d.balance), 1), 0) * 100 : 0;

      return '<div class="card">' +
        '<div class="bucket-top">' +
          '<span class="bucket-name">' +
            '<input class="inp" value="' + esc(d.name) + '" data-id="' + did + '" data-field="name" data-kind="debt" style="font-weight:650;max-width:220px">' +
          '</span>' +
          '<span class="bucket-nums"><b class="' + (gone ? 'pos' : '') + '">' + money(now) + '</b>' +
            (paid > 0 ? ' &middot; <span class="pos">' + money(paid) + ' paid off</span>' : '') + '</span>' +
        '</div>' +
        (paid > 0
          ? '<div class="meter" style="margin-top:8px"><div class="meter-fill" style="width:' + pct.toFixed(1) +
            '%;background:var(--series-4)"></div></div>'
          : '') +
        '<div class="row" style="margin-top:12px">' +
          '<label class="field" style="margin:0"><span>Balance when you started</span>' +
            '<input class="inp num bordered" value="' + num(d.balance).toFixed(2) + '" data-id="' + did + '" data-field="balance" data-kind="debt" inputmode="decimal" style="width:140px"></label>' +
          '<label class="field" style="margin:0"><span>Interest rate %</span>' +
            '<input class="inp num bordered" value="' + (apr ? apr : '') + '" placeholder="optional" data-id="' + did + '" data-field="apr" data-kind="debt" inputmode="decimal" style="width:112px"></label>' +
          '<span class="spacer"></span>' +
          '<button class="btn-icon" data-act="del-debt" data-id="' + did + '" aria-label="Delete" title="Delete">✕</button>' +
        '</div>' +
        '<div class="hint">' + verdict + '</div>' + nudge +
      '</div>';
    }).join('');

    return '<h2 class="section-title">Debts</h2>' +
      '<p class="sub">The number that does not go away on its own — except now it does, when you point money at it. Add the interest rate and Cense will tell you what waiting costs.</p>' +
      (paidAll > 0
        ? '<div class="note"><span>📉</span><span>You have paid off <b>' + money(paidAll) + '</b> since you started tracking.</span></div>'
        : '') +
      (state.debts.length ? cards : '') +
      '<div class="card">' +
        '<h2>' + (state.debts.length ? 'Add a debt' : 'Add a debt — or do not') + '</h2>' +
        (quiet ? '<p class="sub" style="margin-bottom:12px">Nothing owed? Leave this empty. Show-off.</p>' : '') +
        '<div class="row">' +
          '<input class="inp bordered" id="d-name" placeholder="e.g. Student loans" style="flex:2;min-width:160px">' +
          '<input class="inp num bordered" id="d-balance" placeholder="0.00" inputmode="decimal" style="width:140px">' +
          '<input class="inp num bordered" id="d-apr" placeholder="APR %" inputmode="decimal" style="width:110px">' +
          '<button class="btn btn-primary" data-act="add-debt">Add</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------- settings ---------- */

  function viewSettings() {
    var pt = pctTotal();

    var bucketRows = state.buckets.map(function (b) {
      var bid = esc(b.id);
      return '<tr>' +
        '<td class="td-swatch" style="width:34px"><span class="swatch" style="background:' + slotCss(b.slot) + '"></span></td>' +
        '<td data-label="Name"><input class="inp" value="' + esc(b.name) + '" data-id="' + bid + '" data-field="name" data-kind="bucket"></td>' +
        '<td data-label="% of income" style="width:90px"><input class="inp num" value="' + num(b.pct) + '" data-id="' + bid + '" data-field="pct" data-kind="bucket" inputmode="decimal"></td>' +
        '<td data-label="Type" style="width:118px"><select class="inp" data-id="' + bid + '" data-field="kind" data-kind="bucket" title="Saving is money you keep; spending is money that is gone">' +
          '<option value="spend"' + (isSaving(b) ? '' : ' selected') + '>Spending</option>' +
          '<option value="save"' + (isSaving(b) ? ' selected' : '') + '>Saving</option>' +
        '</select></td>' +
        '<td data-label="Color" style="width:120px"><select class="inp" data-id="' + bid + '" data-field="slot" data-kind="bucket">' +
          SLOTS.map(function (s) {
            return '<option value="' + s.id + '"' + (s.id === b.slot ? ' selected' : '') + '>' + s.name + '</option>';
          }).join('') +
        '</select></td>' +
        '<td style="width:34px"><button class="btn-icon" data-act="del-bucket" data-id="' + bid + '" aria-label="Delete" title="Delete">✕</button></td>' +
        '</tr>';
    }).join('');

    return head('Settings') +
      '<p class="sub">The knobs. Turn them.</p>' +

      '<div class="card">' +
        '<h2>What you make</h2>' +
        '<div class="row">' +
          '<label class="field" style="margin:0"><span>Monthly take-home</span>' +
            '<input class="inp num bordered" id="s-income" value="' + num(state.settings.income).toFixed(2) + '" inputmode="decimal" style="width:150px"></label>' +
          '<label class="field" style="margin:0"><span>Payday</span>' +
            '<input class="inp num bordered" id="s-incomeday" value="' + num(state.settings.incomeDay) + '" inputmode="numeric" style="width:92px"></label>' +
        '</div>' +
        '<div class="hint">Every bucket is a slice of the first number. The second is which day of the month it lands.</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2>Running out before payday</h2>' +
        '<label class="field" style="max-width:220px">' +
          '<span>What is in the account now</span>' +
          '<input class="inp num bordered" id="s-startbalance" value="' + num(state.settings.startBalance).toFixed(2) + '" inputmode="decimal">' +
        '</label>' +
        '<div class="hint">Overspending and running out of money are different problems. Give Cense a starting balance and it walks the month day by day — using the days your regulars are due — to find the point where the account dips below zero. Leave it at 0 to turn this off.</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2>Carrying over</h2>' +
        '<label class="row" style="gap:9px">' +
          '<input type="checkbox" id="s-carryover"' + (state.settings.carryover ? ' checked' : '') + '>' +
          '<span>Let last month follow you into this one</span>' +
        '</label>' +
        '<div class="hint" style="margin-top:8px">On: overspending a bucket leaves you owing yourself, and underspending leaves you something extra. Off: every month starts from zero and nothing is remembered. Saving buckets never carry.</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2>Buckets</h2>' +
        (Math.abs(pt - 100) > 0.01
          ? '<div class="note note-warn"><span>⚠</span><span>These come to <b>' + pt + '%</b>. They need to hit 100%.</span></div>'
          : '<div class="note"><span>✓</span><span>Adds up to 100%. Tidy.</span></div>') +
        '<div class="table-wrap"><table class="stack">' +
          '<thead><tr><th></th><th>Name</th><th class="num">% of income</th><th>Type</th><th>Color</th><th></th></tr></thead>' +
          '<tbody>' + bucketRows + '</tbody>' +
        '</table></div>' +
        '<div class="row" style="margin-top:12px">' +
          '<input class="inp bordered" id="b-name" placeholder="New bucket" style="flex:1;min-width:160px">' +
          '<input class="inp num bordered" id="b-pct" placeholder="0" inputmode="decimal" style="width:90px">' +
          '<button class="btn" data-act="add-bucket">Add bucket</button>' +
        '</div>' +
        '<div class="hint" style="margin-top:8px">Call them whatever you like — “Bullshit” is only the default. ' +
          'Mark a bucket <b>Saving</b> and its transfers stop counting as money spent. ' +
          'Deleting a bucket moves its charges to the first one left.</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2>Your data</h2>' +
        '<p class="sub" style="margin-bottom:12px">It lives in this browser and nowhere else. No server has it, which also means no server is keeping it safe for you — export every so often.</p>' +
        '<div class="row">' +
          '<button class="btn" data-act="export">Export backup</button>' +
          '<button class="btn" data-act="import">Restore backup</button>' +
          '<button class="btn" data-act="' + (inDemo() ? 'exit-demo' : 'enter-demo') + '">' +
            (inDemo() ? 'Clear the demo' : 'Load the sample household') + '</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-danger" data-act="reset">Burn it all down</button>' +
        '</div>' +
        (inDemo()
          ? '<div class="hint" style="margin-top:10px">You are in the demo. Your own budget is parked and comes back when you clear it.</div>'
          : '') +
        '<div class="hint" style="margin-top:10px">' +
          plural(state.txns.length, 'charge', 'charges') + ' &middot; ' +
          plural(state.plan.length, 'regular', 'regulars') + ' &middot; ' +
          plural(Object.keys(state.memory).length, 'learned name', 'learned names') +
        '</div>' +
      '</div>';
  }

  /* ---------- CSV import ---------- */

  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false, i;
    for (i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += c;
      } else if (c === '"') { q = true; }
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
      else if (c !== '\r') { cur += c; }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (x) { return String(x).trim() !== ''; });
    });
  }

  /* Returns a real calendar date or nothing at all. Never a well-formed string
     that is not a date: "2025-25-12" would import a charge into a month the
     stepper can never reach, where it counts toward no total and cannot be
     found again. */
  function parseDate(s) {
    s = String(s || '').trim();
    if (!s) return '';

    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var iso = m[1] + '-' + m[2] + '-' + m[3];
      return isYMD(iso) ? iso : '';
    }

    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      var mo = Number(m[1]), da = Number(m[2]);
      /* US exports lead with the month; much of the rest of the world leads
         with the day. Only the unambiguous case can be recovered — 03/07 stays
         a guess, and the mapper says so. */
      if (mo > 12 && da <= 12) { var t = mo; mo = da; da = t; }
      var out = y + '-' + pad(mo) + '-' + pad(da);
      return isYMD(out) ? out : '';
    }

    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return '';
  }

  /* Remember a user's own categorization. A bank row reads "DOMINOS PIZZA 4471
     AUSTIN" and the store number changes every visit, so storing only the full
     string would never match again — also store the leading word(s), which are
     the part that stays put. */
  function learn(payee, bucketId) {
    var key = norm(payee);
    if (!key || !bucketId) return;
    state.memory[key] = bucketId;

    var words = key.split(' ');
    if (words.length > 1) {
      state.memory[words.slice(0, 2).join(' ')] = bucketId;
      if (words[0].length >= 5) state.memory[words[0]] = bucketId;
    }
  }

  /* Bank descriptions carry store numbers and cities ("H-E-B #482 AUSTIN TX"),
     so an exact match rarely fires on imported rows. Fall back to the longest
     remembered name that appears as a whole word inside the description. */
  function matchBucket(payee) {
    var key = norm(payee);
    if (!key) return '';
    if (state.memory[key]) return state.memory[key];

    var padded = ' ' + key + ' ';
    var best = '', bestLen = 0;
    Object.keys(state.memory).forEach(function (k) {
      if (k.length < 3 || k.length <= bestLen) return;
      if (padded.indexOf(' ' + k + ' ') !== -1) {
        best = state.memory[k];
        bestLen = k.length;
      }
    });
    return best;
  }

  /* Same matcher, but always yields something usable — for CSV import, where
     every row needs a bucket even if we have never seen the merchant. */
  function guessBucket(payee) {
    return matchBucket(payee) || (state.buckets[0] ? state.buckets[0].id : '');
  }

  var csvData = null;

  function openImport() {
    csvData = null;
    showModal(
      '<h2>Bring in a bank statement</h2>' +
      '<p class="sub" style="margin-bottom:0">Export a CSV from your bank and drop it here. Nothing is uploaded — the file is read inside this page and never leaves your machine.</p>' +
      '<input type="file" id="csv-file" accept=".csv,text/csv" style="margin:16px 0">' +
      '<div id="csv-step2"></div>' +
      '<div class="row row-end" style="margin-top:16px"><button class="btn" data-act="close-modal">Cancel</button></div>'
    );
    document.getElementById('csv-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var rows = parseCSV(String(reader.result));
          if (rows.length < 2) { toast('That file has no data rows.'); return; }
          csvData = rows;
          renderMapper();
        } catch (err) {
          toast('Could not read that file.');
        }
      };
      reader.readAsText(file);
    });
  }

  function renderMapper() {
    var headers = csvData[0];
    var opts = function (sel) {
      return headers.map(function (h, i) {
        return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' +
          esc(h || ('Column ' + (i + 1))) + '</option>';
      }).join('');
    };
    var find = function (re, fallback) {
      for (var i = 0; i < headers.length; i++) if (re.test(headers[i])) return i;
      return fallback;
    };

    document.getElementById('csv-step2').innerHTML =
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
        '<label class="field"><span>Date column</span><select class="inp" id="m-date">' + opts(find(/date|posted/i, 0)) + '</select></label>' +
        '<label class="field"><span>Description column</span><select class="inp" id="m-payee">' + opts(find(/desc|payee|name|merchant|charge/i, 1)) + '</select></label>' +
        '<label class="field"><span>Amount column</span><select class="inp" id="m-amount">' + opts(find(/amount|debit|value/i, 2)) + '</select></label>' +
      '</div>' +
      '<label class="row" style="margin-bottom:8px;gap:8px">' +
        '<input type="checkbox" id="m-negative" checked>' +
        '<span>Expenses show up as negative numbers in this file (most banks do this)</span>' +
      '</label>' +
      '<label class="row" style="margin-bottom:12px;gap:8px">' +
        '<input type="checkbox" id="m-dupes" checked>' +
        '<span>Skip charges already in Cense (so re-importing a statement does not double it)</span>' +
      '</label>' +
      '<div id="csv-preview"></div>' +
      '<div class="row row-end" style="margin-top:14px"><button class="btn btn-primary" data-act="do-import">Bring them in</button></div>';

    ['m-date', 'm-payee', 'm-amount', 'm-negative', 'm-dupes'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', renderPreview);
    });
    renderPreview();
  }

  var fingerprint = function (date, payee, amount) {
    return date + '|' + norm(payee) + '|' + num(amount).toFixed(2);
  };

  function mappedRows() {
    var m = {
      d: Number(document.getElementById('m-date').value),
      p: Number(document.getElementById('m-payee').value),
      a: Number(document.getElementById('m-amount').value),
      neg: document.getElementById('m-negative').checked
    };

    /* Counted, not just present: two identical coffees on the same day are a
       real thing, so a file containing both when only one is already logged
       flags exactly one of them. Re-importing the same statement flags all. */
    var have = {};
    state.txns.forEach(function (t) {
      var k = fingerprint(t.date, t.payee, t.amount);
      have[k] = (have[k] || 0) + 1;
    });

    var out = [];
    for (var i = 1; i < csvData.length; i++) {
      var r = csvData[i];
      var amount = m.neg ? -num(r[m.a]) : num(r[m.a]);
      if (amount <= 0) continue;               /* skip income / credits */
      var payee = String(r[m.p] || '').trim();
      var date = parseDate(r[m.d]) || todayISO();
      var key = fingerprint(date, payee, amount);
      var dup = have[key] > 0;
      if (dup) have[key]--;
      out.push({
        date: date,
        payee: payee,
        amount: amount,
        bucketId: guessBucket(payee),
        dup: dup
      });
    }
    return out;
  }

  function renderPreview() {
    var rows = mappedRows();
    var skipDupes = document.getElementById('m-dupes').checked;
    var dupes = rows.filter(function (r) { return r.dup; }).length;
    var keep = skipDupes ? rows.filter(function (r) { return !r.dup; }) : rows;
    var show = keep.slice(0, 8);
    var total = keep.reduce(function (a, r) { return a + r.amount; }, 0);

    document.getElementById('csv-preview').innerHTML =
      '<div class="hint" style="margin-bottom:6px">' + plural(keep.length, 'expense', 'expenses') +
      ' to bring in, deposits skipped &middot; ' + money(total) + ' total' +
      (dupes ? ' &middot; <b>' + dupes + '</b> ' +
        (dupes === 1 ? 'already looks like a charge' : 'already look like charges') +
        ' you have' + (skipDupes ? ', skipped' : ', included') : '') + '</div>' +
      (keep.length
        ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Charge</th><th class="num">Amount</th><th>Bucket</th></tr></thead><tbody>' +
          show.map(function (r) {
            var b = bucket(r.bucketId);
            return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.payee) + '</td>' +
              '<td class="num">' + money(r.amount) + '</td><td>' + esc(b ? b.name : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (keep.length > show.length ? '<div class="hint" style="margin-top:6px">…and ' + (keep.length - show.length) + ' more</div>' : '')
        : '<div class="empty" style="padding:16px">' +
          (dupes && skipDupes
            ? 'Every row here is already in Cense. Nothing new to bring in.'
            : 'Nothing to import with these columns. Try a different mapping, or flip that checkbox.') +
          '</div>');
  }

  function doImport() {
    var all = mappedRows();
    var skipDupes = document.getElementById('m-dupes').checked;
    var skipped = skipDupes ? all.filter(function (r) { return r.dup; }).length : 0;
    var rows = skipDupes ? all.filter(function (r) { return !r.dup; }) : all;
    if (!rows.length) {
      toast(skipped ? 'Every charge in that file is already here.' : 'Nothing to import.');
      return;
    }
    rows.forEach(function (r) {
      state.txns.push({
        id: uid(), date: r.date, payee: r.payee,
        amount: r.amount, bucketId: r.bucketId, note: ''
      });
    });
    closeModal();
    /* Land on the newest month the file actually contains, not whatever the
       last row happened to be — plenty of banks export newest-first. */
    var newest = rows.reduce(function (a, r) { return r.date > a ? r.date : a; }, '');
    if (isYM(monthOf(newest))) ui.month = monthOf(newest);
    ui.view = 'transactions';
    toast('Brought in ' + plural(rows.length, 'charge', 'charges') +
      (skipped ? ', skipped ' + skipped + ' you already had' : '') + '. Give the buckets a once-over.');
    commit();
  }

  /* ---------- backup ---------- */

  function exportBackup() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    /* Named so a demo export is never mistaken for the real thing later. */
    a.download = 'cense-' + (inDemo() ? 'DEMO-' : '') + 'backup-' + todayISO() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast(inDemo() ? 'Demo data exported (not your own budget).' : 'Backup saved to your downloads.');
  }

  function importBackup() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        /* Build and validate the replacement completely before the live state
           is touched, and put it back if anything throws on the way. Otherwise
           a file that fails halfway leaves the user with the bad data AND a
           message saying the file was rejected — and the next click saves it. */
        var prev = state;
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.txns)) throw new Error('shape');
          var next = migrate(parsed);
          if (!confirm('Replace everything in Cense with the contents of ' + f.name + '?')) return;
          state = next;
          var months = monthsPresent();
          ui.month = months[months.length - 1] || currentYM();
          ui.lastPost = null;
          toast('Loaded ' + plural(state.txns.length, 'charge', 'charges') + '.');
          commit();
        } catch (e) {
          state = prev;
          toast('That is not a Cense backup.');
        }
      };
      reader.readAsText(f);
    });
    inp.click();
  }

  /* ---------- modal + toast ---------- */

  var modalEl = document.getElementById('modal');

  function showModal(html) {
    modalEl.innerHTML = '<div class="modal">' + html + '</div>';
    modalEl.hidden = false;
  }
  function closeModal() {
    modalEl.hidden = true;
    modalEl.innerHTML = '';
    csvData = null;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3800);
  }

  /* ---------- actions ---------- */

  function addTxn() {
    var payee = document.getElementById('f-payee').value.trim();
    var amount = num(document.getElementById('f-amount').value);
    var date = document.getElementById('f-date').value;
    if (!isYMD(date)) date = todayISO();
    var bucketId = document.getElementById('f-bucket').value;
    var note = document.getElementById('f-note').value.trim();

    if (!payee && !amount) { toast('Needs a charge and an amount.'); return; }

    state.txns.push({ id: uid(), date: date, payee: payee, amount: amount, bucketId: bucketId, note: note });
    learn(payee, bucketId);
    ui.month = monthOf(date);
    commit();
    var f = document.getElementById('f-payee');
    if (f) f.focus();
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');

    if (act === 'month') {
      ui.month = shiftMonth(ui.month, Number(btn.getAttribute('data-delta')));
      render();
    } else if (act === 'add-txn') {
      addTxn();
    } else if (act === 'del-txn') {
      var dt = state.txns.filter(function (t) { return t.id === id; })[0];
      if (!dt) return;
      var dtAt = state.txns.indexOf(dt);
      state.txns = state.txns.filter(function (t) { return t.id !== id; });
      stashUndo('Deleted ' + (dt.payee || 'a charge') + ' — ' + money(dt.amount) + '.', function () {
        state.txns.splice(Math.min(dtAt, state.txns.length), 0, dt);
      });
      commit();
    } else if (act === 'enter-demo') {
      enterDemo();
      toast('Sample household loaded. Nothing of yours was touched.');
    } else if (act === 'exit-demo') {
      exitDemo();
    } else if (act === 'goto-settings') {
      ui.view = 'settings';
      render();
    } else if (act === 'toggle-row') {
      /* Purely a view state — nothing to save, so render rather than commit. */
      if (ui.openRows[id]) delete ui.openRows[id];
      else ui.openRows[id] = 1;
      render();
    } else if (act === 'undo-delete') {
      if (ui.undos.length) {
        var step = ui.undos.pop();
        step.fn();
        commit();
        toast('Put it back.' + (ui.undos.length ? ' ' + ui.undos.length + ' left.' : ''));
      }
    } else if (act === 'dismiss-undo') {
      ui.undos = [];
      render();
    } else if (act === 'undo-post') {
      if (ui.lastPost) undoPost(ui.lastPost);
    } else if (act === 'add-plan') {
      var bid = btn.getAttribute('data-bucket');
      var lEl = document.querySelector('[data-plan-label="' + bid + '"]');
      var aEl = document.querySelector('[data-plan-amount="' + bid + '"]');
      var label = lEl.value.trim();
      if (!label) { toast('Give it a name first.'); return; }
      state.plan.push({ id: uid(), bucketId: bid, label: label, amount: num(aEl.value), auto: false, day: 1 });
      commit();
    } else if (act === 'del-plan') {
      var dp = state.plan.filter(function (p) { return p.id === id; })[0];
      if (!dp) return;
      var dpAt = state.plan.indexOf(dp);
      state.plan = state.plan.filter(function (p) { return p.id !== id; });
      stashUndo('Deleted the ' + (dp.label || 'regular') + ' regular.', function () {
        state.plan.splice(Math.min(dpAt, state.plan.length), 0, dp);
      });
      commit();
    } else if (act === 'add-debt') {
      var dn = document.getElementById('d-name').value.trim();
      if (!dn) { toast('Give it a name first.'); return; }
      state.debts.push({
        id: uid(), name: dn,
        balance: num(document.getElementById('d-balance').value),
        apr: num(document.getElementById('d-apr').value)
      });
      commit();
    } else if (act === 'add-asset') {
      var an = document.getElementById('a-name').value.trim();
      if (!an) { toast('Give it a name first.'); return; }
      state.assets.push({
        id: uid(), name: an,
        kind: document.getElementById('a-kind').value,
        value: num(document.getElementById('a-value').value)
      });
      commit();
    } else if (act === 'del-asset') {
      var da = state.assets.filter(function (a) { return a.id === id; })[0];
      if (!da) return;
      var daAt = state.assets.indexOf(da);
      state.assets = state.assets.filter(function (a) { return a.id !== id; });
      stashUndo('Deleted ' + (da.name || 'an asset') + ' — ' + money(da.value) + '.', function () {
        state.assets.splice(Math.min(daAt, state.assets.length), 0, da);
      });
      commit();
    } else if (act === 'clear-age') {
      state.settings.age = 0;
      commit();
      toast('Age cleared. The comparison is off.');
    } else if (act === 'add-fund') {
      var fn = document.getElementById('fund-name').value.trim();
      if (!fn) { toast('Give it a name first.'); return; }
      var saveB = state.buckets.filter(isSaving)[0];
      state.funds.push({
        id: uid(), name: fn,
        target: num(document.getElementById('fund-target').value),
        every: Math.min(Math.max(Math.round(num(document.getElementById('fund-every').value)) || 12, 0), 120),
        dueMonth: 0,
        bucketId: saveB ? saveB.id : ''
      });
      commit();
    } else if (act === 'del-fund') {
      var df = state.funds.filter(function (f) { return f.id === id; })[0];
      if (!df) return;
      var dfAt = state.funds.indexOf(df);
      state.funds = state.funds.filter(function (f) { return f.id !== id; });
      /* The charges stay; they just stop pointing at a pot that is gone. */
      var untagged = [];
      state.txns.forEach(function (t) { if (t.fundId === id) { untagged.push(t); delete t.fundId; } });
      var unplanned = [];
      state.plan.forEach(function (p) { if (p.fundId === id) { unplanned.push(p); delete p.fundId; } });
      stashUndo('Deleted the ' + (df.name || 'fund') + ' fund.', function () {
        state.funds.splice(Math.min(dfAt, state.funds.length), 0, df);
        untagged.forEach(function (t) { t.fundId = id; });
        unplanned.forEach(function (p) { p.fundId = id; });
      });
      commit();
    } else if (act === 'fund-plan') {
      var f2 = fund(id);
      if (!f2) return;
      var sb = state.buckets.filter(isSaving)[0];
      if (!sb) { toast('Mark a bucket as Saving in Settings first.'); return; }
      state.plan.push({
        id: uid(), bucketId: sb.id, label: f2.name,
        amount: Math.round(fundMonthly(f2) * 100) / 100,
        auto: true, day: 1, fundId: f2.id
      });
      commit();
      toast('Added it to your Regulars. It will post on the 1st.');
    } else if (act === 'del-debt') {
      var dd = state.debts.filter(function (d) { return d.id === id; })[0];
      if (!dd) return;
      var ddAt = state.debts.indexOf(dd);
      state.debts = state.debts.filter(function (d) { return d.id !== id; });
      stashUndo('Deleted ' + (dd.name || 'a debt') + ' — ' + money(dd.balance) + '.', function () {
        state.debts.splice(Math.min(ddAt, state.debts.length), 0, dd);
      });
      commit();
    } else if (act === 'add-bucket') {
      var bn = document.getElementById('b-name').value.trim();
      if (!bn) { toast('Give it a name first.'); return; }
      var used = state.buckets.map(function (b) { return b.slot; });
      var free = SLOTS.filter(function (s) { return used.indexOf(s.id) === -1; })[0];
      state.buckets.push({
        id: uid(), name: bn,
        pct: num(document.getElementById('b-pct').value),
        slot: free ? free.id : SLOTS[SLOTS.length - 1].id,
        kind: 'spend'
      });
      commit();
    } else if (act === 'del-bucket') {
      if (state.buckets.length <= 1) { toast('You need at least one bucket.'); return; }
      var target = state.buckets.filter(function (b) { return b.id !== id; })[0].id;
      var affected = state.txns.filter(function (t) { return t.bucketId === id; }).length;
      if (affected && !confirm(affected + ' charges will move to “' + bucket(target).name + '”. Continue?')) return;
      state.buckets = state.buckets.filter(function (b) { return b.id !== id; });
      state.txns.forEach(function (t) { if (t.bucketId === id) t.bucketId = target; });
      state.plan.forEach(function (p) { if (p.bucketId === id) p.bucketId = target; });
      Object.keys(state.memory).forEach(function (k) { if (state.memory[k] === id) state.memory[k] = target; });
      commit();
    } else if (act === 'import-csv') {
      openImport();
    } else if (act === 'do-import') {
      doImport();
    } else if (act === 'close-modal') {
      closeModal();
    } else if (act === 'export') {
      exportBackup();
    } else if (act === 'import') {
      importBackup();
    } else if (act === 'reset') {
      if (!confirm('This wipes every charge, regular and setting in this browser. Export a backup first if you want to keep any of it. Continue?')) return;
      state = blankState();
      ui.lastPost = null;
      commit();
      toast('Gone. Fresh start.');
    }
  }

  function onChange(e) {
    var el = e.target;
    var field = el.getAttribute('data-field');

    if (el.id === 's-income') { state.settings.income = num(el.value); commit(); return; }
    if (el.id === 's-incomeday') {
      state.settings.incomeDay = Math.min(Math.max(Math.round(num(el.value)) || 1, 1), 31);
      commit(); return;
    }
    if (el.id === 's-startbalance') { state.settings.startBalance = num(el.value); commit(); return; }
    if (el.id === 's-age') {
      state.settings.age = Math.min(Math.max(Math.round(num(el.value)) || 0, 0), 120);
      commit(); return;
    }
    if (el.id === 's-return') {
      state.settings.returnPct = Math.min(Math.max(num(el.value), -20), 40);
      commit(); return;
    }
    if (el.id === 's-annualadd') { state.settings.annualAdd = num(el.value); commit(); return; }
    if (el.id === 's-carryover') { state.settings.carryover = el.checked; commit(); return; }
    if (el.id === 'f-search') return;
    if (!field) return;

    var id = el.getAttribute('data-id');
    var kind = el.getAttribute('data-kind') || 'txn';
    var list = kind === 'plan' ? state.plan
             : kind === 'debt' ? state.debts
             : kind === 'bucket' ? state.buckets
             : kind === 'fund' ? state.funds
             : kind === 'asset' ? state.assets
             : state.txns;
    var item = list.filter(function (x) { return x.id === id; })[0];
    if (!item) return;

    /* Never let a blank or impossible date reach state. It would strand the
       charge in no month at all — invisible in every view, uncountable, and
       impossible to delete — and poison ui.month along the way. */
    if (kind === 'txn' && field === 'date') {
      if (!isYMD(el.value)) {
        el.value = item.date;
        toast('A charge needs a real date.');
        return;
      }
      item.date = el.value;
      ui.month = monthOf(item.date);
      commit();
      return;
    }

    if (field === 'auto') {
      item.auto = el.checked;
      /* Turning a regular on mid-month should post it now, not next month —
         and always into the live month, whichever one is being viewed. */
      if (item.auto) {
        var post = postRegulars(currentYM());
        if (post) {
          ui.lastPost = post;
          if (post.ym !== ui.month) toast('Posted to ' + monthShort(post.ym) + '.');
        }
      }
    } else if (field === 'day') {
      /* 1–31 is storable; postRegulars already clamps to the real length of
         whichever month it posts into, so the 31st lands on the 28th in
         February without the plan forgetting it was the 31st. */
      item.day = Math.min(Math.max(Math.round(num(el.value)) || 1, 1), 31);
    } else if (field === 'kind') {
      item.kind = kind === 'asset'
        ? (ASSET_KINDS.some(function (k) { return k.id === el.value; }) ? el.value : 'other')
        : (el.value === 'save' ? 'save' : 'spend');
    } else if (field === 'toward') {
      setToward(item, el.value);
    } else if (field === 'every') {
      item.every = Math.min(Math.max(Math.round(num(el.value)) || 0, 0), 120);
    } else if (field === 'dueMonth') {
      item.dueMonth = Math.min(Math.max(Math.round(num(el.value)) || 0, 0), 12);
    } else if (field === 'apr') {
      item.apr = Math.min(Math.max(num(el.value), 0), 1000);
    } else if (field === 'amount' || field === 'balance' || field === 'pct' ||
               field === 'slot' || field === 'target' || field === 'value') {
      item[field] = num(el.value);
    } else {
      item[field] = el.value;
    }

    if (kind === 'txn' && (field === 'bucketId' || field === 'payee')) learn(item.payee, item.bucketId);

    commit();
  }

  function onInput(e) {
    if (e.target.id === 'f-search') {
      ui.search = e.target.value;
      render();          /* render() now restores the caret for every field */
    }
    if (e.target.id === 'f-payee') {
      var guess = matchBucket(e.target.value);
      var sel = document.getElementById('f-bucket');
      if (guess && sel) sel.value = guess;
    }
  }

  function onKey(e) {
    if (e.key !== 'Enter') return;
    var id = e.target.id;
    if (id === 'f-payee' || id === 'f-amount' || id === 'f-note' || id === 'f-date') {
      e.preventDefault();
      addTxn();
    } else if (id === 'd-name' || id === 'd-balance') {
      e.preventDefault();
      document.querySelector('[data-act="add-debt"]').click();
    } else if (e.target.hasAttribute('data-plan-label') || e.target.hasAttribute('data-plan-amount')) {
      e.preventDefault();
      var b = e.target.getAttribute('data-plan-label') || e.target.getAttribute('data-plan-amount');
      document.querySelector('[data-act="add-plan"][data-bucket="' + b + '"]').click();
    }
  }

  /* ---------- render ---------- */

  var viewEl = document.getElementById('view');

  /* Every commit replaces the whole view, which dropped focus to <body> after
     each edit — so tabbing across a row was impossible and categorizing an
     import meant reaching for the mouse on every field. Remember where the
     caret was and put it back on the element that replaced the old one. */
  function focusKey() {
    var a = document.activeElement;
    if (!a || !viewEl.contains(a)) return null;
    var k = {
      id: a.id || null,
      did: a.getAttribute('data-id'),
      field: a.getAttribute('data-field'),
      dkind: a.getAttribute('data-kind'),
      pl: a.getAttribute('data-plan-label'),
      pa: a.getAttribute('data-plan-amount'),
      start: null, end: null
    };
    try { k.start = a.selectionStart; k.end = a.selectionEnd; } catch (e) { /* date/number inputs */ }
    return k;
  }

  function restoreFocus(k) {
    if (!k) return;
    var el = null;
    if (k.id) {
      el = document.getElementById(k.id);
    } else if (k.did && k.field) {
      el = viewEl.querySelector('[data-id="' + k.did + '"][data-field="' + k.field + '"]' +
        (k.dkind ? '[data-kind="' + k.dkind + '"]' : ''));
    } else if (k.pl) {
      el = viewEl.querySelector('[data-plan-label="' + k.pl + '"]');
    } else if (k.pa) {
      el = viewEl.querySelector('[data-plan-amount="' + k.pa + '"]');
    }
    if (!el) return;
    el.focus();
    if (k.start != null) {
      try { el.setSelectionRange(k.start, k.end); } catch (e) { /* unsupported input type */ }
    }
  }

  function render() {
    /* The live month catches up before anything is measured, whichever month
       is on screen, so the dashboard and the spending list always agree. */
    var post = postRegulars(currentYM());
    if (post) {
      ui.lastPost = post;
      /* Rolling over with the tab open used to book real money behind a banner
         that only renders on the month being viewed — silently, with the Undo
         out of reach. Follow the money to the month it landed in. */
      ui.month = post.ym;
    }

    var hold = focusKey();

    viewEl.innerHTML = demoBanner() + alarmBanners() + undoBanner() + postBanner() + (
      ui.view === 'transactions' ? viewTransactions() :
      ui.view === 'regulars' ? viewRegulars() :
      ui.view === 'toward' ? viewToward() :
      ui.view === 'worth' ? viewWorth() :
      ui.view === 'settings' ? viewSettings() :
      viewDashboard()
    );

    restoreFocus(hold);

    /* Every [data-view] control, not just .nav-btn — Settings lives in the top
       bar as an icon now and still needs to show as the current page. */
    [].forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      if (b.getAttribute('data-view') === ui.view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /* ---------- privacy ---------- */

  var EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  var EYE_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24' +
    'A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function paintPrivacy() {
    var btn = document.getElementById('privacyToggle');
    if (!btn) return;
    document.body.classList.toggle('private', hideMoney);
    btn.innerHTML = hideMoney ? EYE_OFF : EYE;
    btn.setAttribute('aria-pressed', hideMoney ? 'true' : 'false');
    var label = hideMoney ? 'Show amounts' : 'Hide amounts';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label + ' (Ctrl+H)');
  }

  function togglePrivacy() {
    hideMoney = !hideMoney;
    try { localStorage.setItem(PRIVATE_KEY, hideMoney ? '1' : '0'); } catch (e) { /* fine, just not sticky */ }
    paintPrivacy();
    render();
  }

  function initPrivacy() {
    try { hideMoney = localStorage.getItem(PRIVATE_KEY) === '1'; } catch (e) { hideMoney = false; }
    paintPrivacy();
    document.getElementById('privacyToggle').addEventListener('click', togglePrivacy);
    /* Someone walking up behind you is a two-second problem, and reaching for
       the mouse is most of those two seconds. */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        togglePrivacy();
      }
    });
  }

  /* ---------- theme ---------- */

  function initTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeToggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var isDark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_KEY, next);
    });
  }

  /* ---------- boot ---------- */

  /* Bound to the whole bar rather than the nav strip, so the Settings gear
     sitting outside the strip routes through the same handler. */
  document.querySelector('.topbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    ui.view = b.getAttribute('data-view');
    render();
  });

  viewEl.addEventListener('click', onClick);
  viewEl.addEventListener('change', onChange);
  viewEl.addEventListener('input', onInput);
  viewEl.addEventListener('keydown', onKey);
  modalEl.addEventListener('click', function (e) {
    if (e.target === modalEl) { closeModal(); return; }
    onClick(e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalEl.hidden) closeModal();
  });

  initTheme();
  initPrivacy();      /* before the first render, so nothing flashes unmasked */
  load();
  /* ?demo=1 is how the landing page hands someone straight into a full app
     rather than an empty one. enterDemo commits, which renders. */
  if (/[?&]demo=1(&|$)/.test(location.search) && !inDemo()) enterDemo();
  else render();
})();
