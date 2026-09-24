/* ==========================================================================
   V-Schedule  /  control
   --------------------------------------------------------------------------
   Storage key : "vschedule.v1"
   Shape       : { start:"YYYY-MM-DD", days:Number,
                   items:{ "YYYY-MM-DD":[ {t:"HH:MM", x:"text"}, ... ] },
                   viewColor:"#rrggbb", clockColor:"#rrggbb", viewOpacity:Number,
                   bgOn:Boolean, bgFill:"#rrggbb", bgBorder:Boolean,
                   bgBorderColor:"#rrggbb",
                    bgW:Number, bgH:Number  (横のゲージ),
                    tateBgW:Number, tateBgH:Number  (縦のゲージ — 縦幅の上限は150%),
                   showOff:Boolean, theme:"yoko"|"tate" }
   Same key is read by view.html -> the display page mirrors this data live.

   「背景の横幅」「背景の縦幅」だけはテーマごとに別の値を持つ
   (他の項目は横・縦で共通)。

   Two tabs: 予定 ( ◀ / 今日 / ▶ / 表示日数 / 一覧と入力 ) and 設定, which is
   split into two sections:
     [デザイン] テーマ / ベースカラー + 時計文字カラー / 不透明度 /
                背景 + 背景の色 / 背景のフチ + フチの色 /
                背景の横幅 / 背景の縦幅
     [項目]     お休みの表示
   A day with no entry is an "お休み" day.
   ========================================================================== */
(function () {
"use strict";

var STORE_KEY = "vschedule.v1";
var DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
var MAX_DAYS = 31;
var DEFAULT_DAYS = 7;
var DEFAULT_VIEW_COLOR = "#333333"; /* the view's ink — the simple skin's own colour */
var DEFAULT_CLOCK_COLOR = "#ffffff";/* 時計の文字の色 */
var DEFAULT_THEME = "yoko";         /* yoko = simple skin / tate = stacked rows */
var OFF_LABEL = "お休み";
var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
var DEFAULT_VIEW_OPACITY = 100;

var DEFAULT_BG_ON = false;             /* 背景の四角 — 既定はOFF(何も描かない) */
var DEFAULT_BG_FILL = "#ffffff";       /* 四角の塗り */
var DEFAULT_BG_BORDER = true;          /* 四角のフチ */
var DEFAULT_BG_BORDER_COLOR = "#333333";
var DEFAULT_BG_W = 100;                /* % — 基準(カードの内側いっぱい)に対する割合 */
var DEFAULT_BG_H = 100;
var BG_MIN = 40;                       /* % — いちばん短いところ */
var BG_MAX = 110;                      /* % — いちばん長いところ(カードの外形まで) */
var BG_MAX_W_YOKO = 105;               /* % — 横は左端固定なので、右へ伸ばせるのはここまで */
var BG_MIN_W_TATE = 20;                /* % — 縦は横幅の最小=160pxまで縮められる */
var BG_MAX_H_TATE = 150;               /* % — 縦の「縦幅」の上限。横(110%)より高く、
                                           カードの上下へもはみ出して伸ばせる */
var DEFAULT_SHOW_OFF = true;           /* お休み(予定なしの日)を表示する */

/* ------------------------------------------------------------------ date */
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function toISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function fromISO(s) { var p = String(s).split("-"); return new Date(+p[0], (+p[1]) - 1, +p[2]); }
function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }
function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function todayISO() { return toISO(new Date()); }

/* current hour, minutes reset to 00 — the default for a freshly added entry */
function defaultTime() { return pad2(new Date().getHours()) + ":00"; }

/* the entry after this one starts an hour later (clamped at 23:59) */
function plusHour(v) {
	var t = normTime(v);
	if (!t) return defaultTime();
	var m = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10) + 60;
	if (m > 23 * 60 + 59) m = 23 * 60 + 59;
	return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
}

/* default time for a new entry on this day = last known time + 1 hour */
function nextDefaultTime(iso) {
	var arr = readItems(iso);
	for (var i = arr.length - 1; i >= 0; i--) {
		var t = normTime(arr[i].t);
		if (t) return plusHour(t);
	}
	return defaultTime();
}

/* grow the visible range so that this date can be shown */
function ensureVisible(iso) {
	var idx = Math.round((fromISO(iso) - fromISO(state.start)) / 86400000);
	if (isNaN(idx) || idx < 0) return;
	if (idx + 1 > state.days) state.days = Math.min(MAX_DAYS, idx + 1);
}

function normTime(v) {
	var s = String(v == null ? "" : v).replace(/[^0-9:]/g, "");
	var h = null, m = 0, p;
	if (s === "") return "";
	if (s.indexOf(":") >= 0) {
		p = s.split(":");
		h = parseInt(p[0], 10);
		m = parseInt(String(p[1] || "").replace(/[^0-9]/g, "") || "0", 10);
	} else if (s.length <= 2) {
		h = parseInt(s, 10);
	} else if (s.length === 3) {
		h = parseInt(s.slice(0, 1), 10);
		m = parseInt(s.slice(1), 10);
	} else {
		h = parseInt(s.slice(0, 2), 10);
		m = parseInt(s.slice(2, 4), 10);
	}
	if (isNaN(h)) h = 0;
	if (isNaN(m)) m = 0;
	h = Math.max(0, Math.min(23, h));
	m = Math.max(0, Math.min(59, m));
	return pad2(h) + ":" + pad2(m);
}

/* ----------------------------------------------------------------- state */
var state = {
	start: "", days: DEFAULT_DAYS, items: {},
	viewColor: DEFAULT_VIEW_COLOR, clockColor: DEFAULT_CLOCK_COLOR, viewOpacity: DEFAULT_VIEW_OPACITY,
	bgOn: DEFAULT_BG_ON, bgFill: DEFAULT_BG_FILL, bgBorder: DEFAULT_BG_BORDER,
	bgBorderColor: DEFAULT_BG_BORDER_COLOR, bgW: DEFAULT_BG_W, bgH: DEFAULT_BG_H,
	tateBgW: DEFAULT_BG_W, tateBgH: DEFAULT_BG_H,
	showOff: DEFAULT_SHOW_OFF, theme: DEFAULT_THEME
};
var els = {};

/* 縦幅のゲージ — 上限はテーマでちがう(縦はカードの外へも出られるので 150% まで) */
function clampPct(n, fallback, theme) {
	n = parseInt(n, 10);
	if (isNaN(n)) return fallback;
	var t = theme || state.theme;
	var hi = t === "tate" ? BG_MAX_H_TATE : BG_MAX;
	return Math.max(BG_MIN, Math.min(hi, n));
}

/* 横幅のゲージ — 下限はテーマでちがう(縦は 20% まで縮められる) */
function clampW(n, fallback, theme) {
	n = parseInt(n, 10);
	if (isNaN(n)) return fallback;
	var t = theme || state.theme;
	var lo = t === "tate" ? BG_MIN_W_TATE : BG_MIN;
	return Math.max(lo, Math.min(BG_MAX, n));
}

/* ゲージの値はテーマごとに別のキーへ入れる(bgW/bgH と tateBgW/tateBgH) */
function gaugeKey(k) { return state.theme === "tate" ? "tate" + k.charAt(0).toUpperCase() + k.slice(1) : k; }
function gaugeGet(k) { return state[gaugeKey(k)]; }
function gaugeSet(k, v) { state[gaugeKey(k)] = v; }

function load() {
	state.start = todayISO();
	state.days = DEFAULT_DAYS;
	state.items = {};
	state.viewColor = DEFAULT_VIEW_COLOR;
	state.clockColor = DEFAULT_CLOCK_COLOR;
	state.viewOpacity = DEFAULT_VIEW_OPACITY;
	state.bgOn = DEFAULT_BG_ON;
	state.bgFill = DEFAULT_BG_FILL;
	state.bgBorder = DEFAULT_BG_BORDER;
	state.bgBorderColor = DEFAULT_BG_BORDER_COLOR;
	state.bgW = DEFAULT_BG_W;
	state.bgH = DEFAULT_BG_H;
	state.tateBgW = DEFAULT_BG_W;
	state.tateBgH = DEFAULT_BG_H;
	state.showOff = DEFAULT_SHOW_OFF;
	state.theme = DEFAULT_THEME;

	var raw = null;
	try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
	if (!raw) return;

	var o = null;
	try { o = JSON.parse(raw); } catch (e) { return; }
	if (!o || typeof o !== "object") return;

	if (isISO(o.start)) state.start = o.start;
	var n = parseInt(o.days, 10);
	if (!isNaN(n)) state.days = Math.max(1, Math.min(MAX_DAYS, n));
	if (typeof o.viewColor === "string" && COLOR_RE.test(o.viewColor)) state.viewColor = o.viewColor;
	if (typeof o.clockColor === "string" && COLOR_RE.test(o.clockColor)) state.clockColor = o.clockColor;
	var op = parseInt(o.viewOpacity, 10);
	if (!isNaN(op)) state.viewOpacity = Math.max(0, Math.min(100, op));
	if (typeof o.bgOn === "boolean") state.bgOn = o.bgOn;
	if (typeof o.bgFill === "string" && COLOR_RE.test(o.bgFill)) state.bgFill = o.bgFill;
	if (typeof o.bgBorder === "boolean") state.bgBorder = o.bgBorder;
	if (typeof o.bgBorderColor === "string" && COLOR_RE.test(o.bgBorderColor)) state.bgBorderColor = o.bgBorderColor;
	/* テーマを先に読む — 横幅の下限がテーマで変わるため */
	if (o.theme === "yoko" || o.theme === "tate") state.theme = o.theme;
	/* 横幅/縦幅はテーマごとに別。旧形式(bgW/bgH しか無い)は
	   いま選んでいるテーマの枠に入れる。 */
	var tw = parseInt(o.tateBgW, 10), th = parseInt(o.tateBgH, 10);
	var legacy = isNaN(tw) && isNaN(th);
	if (legacy && state.theme === "tate") { tw = parseInt(o.bgW, 10); th = parseInt(o.bgH, 10); }
	state.bgW = (legacy && state.theme === "tate") ? DEFAULT_BG_W : clampW(o.bgW, DEFAULT_BG_W, "yoko");
	state.bgH = (legacy && state.theme === "tate") ? DEFAULT_BG_H : clampPct(o.bgH, DEFAULT_BG_H, "yoko");
	state.tateBgW = clampW(tw, DEFAULT_BG_W, "tate");
	state.tateBgH = clampPct(th, DEFAULT_BG_H, "tate");
	if (typeof o.showOff === "boolean") state.showOff = o.showOff;

	if (o.items && typeof o.items === "object" && !Array.isArray(o.items)) {
		for (var k in o.items) {
			if (!Object.prototype.hasOwnProperty.call(o.items, k)) continue;
			if (!isISO(k) || !Array.isArray(o.items[k])) continue;
			var src = o.items[k], arr = [];
			for (var i = 0; i < src.length; i++) {
				var it = src[i] || {};
				arr.push({
					t: String(it.t == null ? "" : it.t),
					x: String(it.x == null ? "" : it.x)
				});
			}
			if (arr.length) state.items[k] = arr;
		}
	}
}

function save() {
	var keep = {};
	for (var k in state.items) {
		if (Object.prototype.hasOwnProperty.call(state.items, k) &&
			Array.isArray(state.items[k]) && state.items[k].length) {
			keep[k] = state.items[k];
		}
	}
	state.items = keep;
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify({
			start: state.start,
			days: state.days,
			items: state.items,
			viewColor: state.viewColor,
			clockColor: state.clockColor,
			viewOpacity: state.viewOpacity,
			bgOn: state.bgOn,
			bgFill: state.bgFill,
			bgBorder: state.bgBorder,
			bgBorderColor: state.bgBorderColor,
			bgW: state.bgW,
			bgH: state.bgH,
			tateBgW: state.tateBgW,
			tateBgH: state.tateBgH,
			showOff: state.showOff,
			theme: state.theme
		}));
	} catch (e) { /* storage full or unavailable */ }
}

/* array of entries for a date — creates it on demand (used when adding) */
function itemsOf(iso) {
	if (!Array.isArray(state.items[iso])) state.items[iso] = [];
	return state.items[iso];
}
/* read-only accessor used by the renderer (never creates keys) */
function readItems(iso) {
	var a = state.items[iso];
	return Array.isArray(a) ? a : [];
}

/* --------------------------------------------------------------- render */
function render(focus) {
	var frag = document.createDocumentFragment();
	for (var i = 0; i < state.days; i++) {
		frag.appendChild(buildRow(addDays(state.start, i)));
	}
	els.rows.textContent = "";
	els.rows.appendChild(frag);
	if (focus) focusEntry(focus);
}

function addButton(iso) {
	var add = document.createElement("button");
	add.type = "button";
	add.className = "add";
	add.innerHTML = '<span class="plus">+</span><span>予定を追加</span>';
	add.addEventListener("click", function () { addEntry(iso); });
	return add;
}

function buildRow(iso) {
	var d = fromISO(iso);
	var dowIndex = d.getDay();

	var row = document.createElement("div");
	row.className = "day-row" + (iso === todayISO() ? " is-today" : "");
	row.setAttribute("data-date", iso);

	var cell = document.createElement("div");
	cell.className = "dcell";

	var num = document.createElement("span");
	num.className = "dnum";
	num.textContent = String(d.getDate());

	var dow = document.createElement("span");
	dow.className = "ddow" + (dowIndex === 6 ? " sat" : (dowIndex === 0 ? " sun" : ""));
	dow.textContent = DOW[dowIndex];

	cell.appendChild(num);
	cell.appendChild(dow);
	row.appendChild(cell);

	var body = document.createElement("div");
	body.className = "dbody";

	var items = readItems(iso);

	if (!items.length) {
		/* nothing planned — the day is off, so the row says so on one line */
		var offrow = document.createElement("div");
		offrow.className = "offrow";
		var off = document.createElement("span");
		off.className = "off";
		off.textContent = OFF_LABEL;
		offrow.appendChild(off);
		offrow.appendChild(addButton(iso));
		body.appendChild(offrow);
	} else {
		for (var i = 0; i < items.length; i++) {
			body.appendChild(buildEntry(iso, items, i));
		}
		body.appendChild(addButton(iso));
	}

	row.appendChild(body);
	return row;
}

function buildEntry(iso, items, index) {
	var item = items[index];

	var entry = document.createElement("div");
	entry.className = "entry";

	var time = document.createElement("input");
	time.type = "text";
	time.className = "pill";
	time.value = item.t || "";
	time.placeholder = "00:00";
	time.maxLength = 5;
	time.setAttribute("inputmode", "numeric");
	time.setAttribute("aria-label", "時刻");

	var text = document.createElement("input");
	text.type = "text";
	text.className = "etext";
	text.value = item.x || "";
	text.placeholder = "予定を入力";
	text.setAttribute("aria-label", "予定");

	var del = document.createElement("button");
	del.type = "button";
	del.className = "del";
	del.setAttribute("aria-label", "この予定を削除");
	del.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true">' +
		'<path d="M1.2 1.2 L10.8 10.8 M10.8 1.2 L1.2 10.8"/></svg>';

	time.addEventListener("input", function () {
		var v = time.value.replace(/[^0-9:]/g, "").slice(0, 5);
		if (v !== time.value) time.value = v;
		item.t = time.value;
		save();
	});
	time.addEventListener("blur", function () {
		var v = normTime(time.value);
		time.value = v;
		item.t = v;
		save();
	});
	time.addEventListener("keydown", function (ev) {
		if (ev.key === "Enter") { time.blur(); }
	});

	text.addEventListener("input", function () {
		item.x = text.value;
		save();
	});

	/* the text field carries the whole form:
	   Backspace on an empty field -> this entry is dropped
	   Enter with text             -> a new form on the SAME day (+1 hour)
	   Enter while blank           -> this blank form is dropped and the
	                                  NEXT day's form opens */
	text.addEventListener("keydown", function (ev) {
		if (ev.isComposing || ev.keyCode === 229) return;
		if (ev.key === "Backspace" && text.value === "") {
			ev.preventDefault();
			removeEntry(iso, index, false);
			return;
		}
		if (ev.key !== "Enter") return;
		ev.preventDefault();
		if (text.value.trim() === "") {
			removeEntry(iso, index, true);
		} else {
			addEntry(iso, "text");
		}
	});

	del.addEventListener("click", function () {
		removeEntry(iso, index, false);
	});

	entry.appendChild(time);
	entry.appendChild(text);
	entry.appendChild(del);
	return entry;
}

function addEntry(iso, field) {
	var items = itemsOf(iso);
	items.push({ t: nextDefaultTime(iso), x: "" });
	save();
	render({ date: iso, index: items.length - 1, field: field || "text" });
}

/* drop one entry — goNext carries on to the next day (Enter on a blank form) */
function removeEntry(iso, index, goNext) {
	var items = readItems(iso);
	items.splice(index, 1);
	save();
	if (goNext) {
		var next = addDays(iso, 1);
		ensureVisible(next);
		render();
		addEntry(next, "text");
		return;
	}
	/* the cursor goes back to the previous form, or to "予定を追加" */
	render(index > 0 ? { date: iso, index: index - 1, field: "text" } : { date: iso, add: true });
}

function focusEntry(spec) {
	var row = els.rows.querySelector('[data-date="' + spec.date + '"]');
	if (!row) return;
	if (spec.add) {
		var btn = row.querySelector(".add");
		if (btn) btn.focus();
		return;
	}
	var entries = row.querySelectorAll(".entry");
	var entry = entries[spec.index];
	if (!entry) return;
	var el = entry.querySelector(spec.field === "time" ? ".pill" : ".etext");
	if (!el) return;
	el.focus();
	if (typeof el.setSelectionRange === "function") {
		try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* not selectable */ }
	}
}

/* ------------------------------------------------------------------- ui */
function syncHeader() {
	els.count.value = state.days;
	els.viewColor.value = state.viewColor;
	els.clockColor.value = state.clockColor;
	els.viewOpacity.value = state.viewOpacity;
	els.viewOpacityText.textContent = state.viewOpacity + "%";
	els.bgFill.value = state.bgFill;
	els.bgBorderColor.value = state.bgBorderColor;
	/* ゲージの上限 = 基準(中身)からカードの端までの距離。
	   横 : 左端が中身の左端で固定なので、右へ伸ばせるのは 105% まで。
	        高さもカードの中に収める(上限 110% のまま)。
	   縦 : 左右は中央のまま 110%。高さはカードの上下へもはみ出せるので
	        上限を 150% まで拡張した。横幅は 20%(160px)まで縮められる。 */
	els.bgW.max = state.theme === "tate" ? BG_MAX : BG_MAX_W_YOKO;
	els.bgW.min = state.theme === "tate" ? BG_MIN_W_TATE : BG_MIN;
	els.bgH.max = state.theme === "tate" ? BG_MAX_H_TATE : BG_MAX;
	var gw = clampW(gaugeGet("bgW"), DEFAULT_BG_W);
	var gh = clampPct(gaugeGet("bgH"), DEFAULT_BG_H);
	gaugeSet("bgW", gw);
	gaugeSet("bgH", gh);
	els.bgW.value = gw;
	els.bgH.value = gh;
	els.bgWText.textContent = gw + "%";
	els.bgHText.textContent = gh + "%";
	setTheme(state.theme);
	setBg(state.bgOn);
	setBgBorder(state.bgBorder);
	setShowOff(state.showOff);
}

/* 予定 / 設定 のタブ切り替え — 1画面に積むと OBS ドックで縦に伸びるため */
function setTab(name) {
	var i, on;
	for (i = 0; i < els.tabBtns.length; i++) {
		on = els.tabBtns[i].getAttribute("data-tab") === name;
		els.tabBtns[i].className = "tab" + (on ? " is-on" : "");
		els.tabBtns[i].setAttribute("aria-selected", on ? "true" : "false");
	}
	for (i = 0; i < els.panes.length; i++) {
		on = els.panes[i].getAttribute("data-pane") === name;
		els.panes[i].className = "tabpane" + (on ? " is-on" : "");
	}
}

/* 背景(四角) — 表示要素の後ろに四角を1枚敷く。OFF のときは何も描かない。
   四角に関わる他の設定(色/フチ/長さ)は、四角が無いと意味がないのでまとめて無効化 */
function setBg(on) {
	state.bgOn = !!on;
	var i;
	for (i = 0; i < els.bgBtns.length; i++) {
		var b = els.bgBtns[i];
		var hit = (b.getAttribute("data-bg") === "on") === state.bgOn;
		b.className = "seg" + (hit ? " is-on" : "");
		b.setAttribute("aria-pressed", hit ? "true" : "false");
	}
	var dis = !state.bgOn;
	els.bgFill.disabled = dis;
	els.bgBorderColor.disabled = dis;
	els.bgW.disabled = dis;
	els.bgH.disabled = dis;
	for (i = 0; i < els.bgBorderBtns.length; i++) els.bgBorderBtns[i].disabled = dis;
}

/* 背景のフチ — 四角の枠線の有無 */
function setBgBorder(on) {
	state.bgBorder = !!on;
	for (var i = 0; i < els.bgBorderBtns.length; i++) {
		var b = els.bgBorderBtns[i];
		var hit = (b.getAttribute("data-bgborder") === "on") === state.bgBorder;
		b.className = "seg" + (hit ? " is-on" : "");
		b.setAttribute("aria-pressed", hit ? "true" : "false");
	}
	els.bgBorderColor.disabled = !state.bgOn || !state.bgBorder;
}

/* お休みの表示 */
function setShowOff(on) {
	state.showOff = !!on;
	for (var i = 0; i < els.showOffBtns.length; i++) {
		var b = els.showOffBtns[i];
		var hit = (b.getAttribute("data-showoff") === "on") === state.showOff;
		b.className = "seg" + (hit ? " is-on" : "");
		b.setAttribute("aria-pressed", hit ? "true" : "false");
	}
}

/* view theme — 横 (simple skin) / 縦 (stacked rows)
   テーマを跨ぐときは、いま画面に出ているゲージの値を「いまのテーマの枠」に
   預けてから、切り替え先の値を読み直す(横幅・縦幅だけがテーマ別)。 */
function setTheme(name) {
	var next = name === "tate" ? "tate" : "yoko";
	if (next !== state.theme) {
		gaugeSet("bgW", clampW(els.bgW.value, DEFAULT_BG_W));
		gaugeSet("bgH", clampPct(els.bgH.value, DEFAULT_BG_H));
		state.theme = next;
	}
	for (var i = 0; i < els.themeBtns.length; i++) {
		var b = els.themeBtns[i];
		var on = b.getAttribute("data-theme") === state.theme;
		b.className = "seg" + (on ? " is-on" : "");
		b.setAttribute("aria-pressed", on ? "true" : "false");
	}
}

/* one place for the day count — the field and the ▲▼ stepper both use it */
function setDays(n) {
	n = parseInt(n, 10);
	if (isNaN(n)) n = state.days;
	n = Math.max(1, Math.min(MAX_DAYS, n));
	state.days = n;
	els.count.value = n;
	save();
	render();
}

/* ◀ / ▶ はどちらも開始日を1日ずらすだけ。今日は今日へ戻す */
function step(delta) {
	state.start = addDays(state.start, delta);
	save();
	render();
}

function goToday() {
	state.start = todayISO();
	save();
	render();
}

function init() {
	els.rows = document.getElementById("rows");
	els.tabBtns = document.querySelectorAll(".tab[data-tab]");
	els.panes = document.querySelectorAll(".tabpane[data-pane]");
	els.bgBtns = document.querySelectorAll(".seg[data-bg]");
	els.bgBorderBtns = document.querySelectorAll(".seg[data-bgborder]");
	els.showOffBtns = document.querySelectorAll(".seg[data-showoff]");
	els.count = document.getElementById("dayCount");
	els.viewColor = document.getElementById("viewColor");
	els.clockColor = document.getElementById("clockColor");
	els.viewOpacity = document.getElementById("viewOpacity");
	els.viewOpacityText = document.getElementById("viewOpacityText");
	els.bgFill = document.getElementById("bgFill");
	els.bgBorderColor = document.getElementById("bgBorderColor");
	els.bgW = document.getElementById("bgW");
	els.bgH = document.getElementById("bgH");
	els.bgWText = document.getElementById("bgWText");
	els.bgHText = document.getElementById("bgHText");
	els.dayUp = document.getElementById("dayUp");
	els.dayDown = document.getElementById("dayDown");
	els.themeBtns = document.querySelectorAll(".seg[data-theme]");
	els.prev = document.getElementById("prev");
	els.next = document.getElementById("next");
	els.today = document.getElementById("today");
	els.reset = document.getElementById("reset");

	load();
	syncHeader();
	render();

	els.prev.addEventListener("click", function () { step(-1); });
	els.next.addEventListener("click", function () { step(+1); });
	els.today.addEventListener("click", goToday);

	setTab("sched");
	for (var tb = 0; tb < els.tabBtns.length; tb++) {
		els.tabBtns[tb].addEventListener("click", function () {
			setTab(this.getAttribute("data-tab"));
		});
	}
	for (var bb = 0; bb < els.bgBtns.length; bb++) {
		els.bgBtns[bb].addEventListener("click", function () {
			setBg(this.getAttribute("data-bg") === "on");
			save();
		});
	}
	for (var gb = 0; gb < els.bgBorderBtns.length; gb++) {
		els.bgBorderBtns[gb].addEventListener("click", function () {
			setBgBorder(this.getAttribute("data-bgborder") === "on");
			save();
		});
	}
	for (var sb = 0; sb < els.showOffBtns.length; sb++) {
		els.showOffBtns[sb].addEventListener("click", function () {
			setShowOff(this.getAttribute("data-showoff") === "on");
			save();
		});
	}

	els.dayUp.addEventListener("click", function () { setDays(state.days + 1); });
	els.dayDown.addEventListener("click", function () { setDays(state.days - 1); });

	for (var t = 0; t < els.themeBtns.length; t++) {
		els.themeBtns[t].addEventListener("click", function () {
			setTheme(this.getAttribute("data-theme"));
			syncHeader();
			save();
			render();
		});
	}

	els.viewColor.addEventListener("input", function () {
		if (!COLOR_RE.test(els.viewColor.value)) return;
		state.viewColor = els.viewColor.value;
		save();
	});

	els.clockColor.addEventListener("input", function () {
		if (!COLOR_RE.test(els.clockColor.value)) return;
		state.clockColor = els.clockColor.value;
		save();
	});

	els.viewOpacity.addEventListener("input", function () {
		var v = parseInt(els.viewOpacity.value, 10);
		if (isNaN(v)) return;
		state.viewOpacity = Math.max(0, Math.min(100, v));
		els.viewOpacityText.textContent = state.viewOpacity + "%";
		save();
	});

	els.bgFill.addEventListener("input", function () {
		if (!COLOR_RE.test(els.bgFill.value)) return;
		state.bgFill = els.bgFill.value;
		save();
	});

	els.bgBorderColor.addEventListener("input", function () {
		if (!COLOR_RE.test(els.bgBorderColor.value)) return;
		state.bgBorderColor = els.bgBorderColor.value;
		save();
	});

	els.bgW.addEventListener("input", function () {
		var v = clampW(els.bgW.value, DEFAULT_BG_W);
		gaugeSet("bgW", v);
		els.bgWText.textContent = v + "%";
		save();
	});

	els.bgH.addEventListener("input", function () {
		var v = clampPct(els.bgH.value, DEFAULT_BG_H);
		gaugeSet("bgH", v);
		els.bgHText.textContent = v + "%";
		save();
	});

	els.count.addEventListener("change", function () { setDays(els.count.value); });

	els.reset.addEventListener("click", function () {
		if (!window.confirm("すべての予定を削除しますか？")) return;
		try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
		load();
		syncHeader();
		render();
	});

	window.addEventListener("storage", function (ev) {
		if (ev.key && ev.key !== STORE_KEY) return;
		load();
		syncHeader();
		render();
	});
}

document.addEventListener("DOMContentLoaded", init);
})();
