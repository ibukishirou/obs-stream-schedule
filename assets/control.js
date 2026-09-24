/* ==========================================================================
   V-Schedule  /  control
   --------------------------------------------------------------------------
   Storage key : "vschedule.v1"
   Shape       : { start:"YYYY-MM-DD", days:Number,
                   items:{ "YYYY-MM-DD":[ {t:"HH:MM", x:"text"}, ... ] },
                   viewColor:"#rrggbb", theme:"yoko"|"tate" }
   Same key is read by view.html -> the display page mirrors this data live.

   One page, no tabs: 表示日数 / テーマ / カラー sit in a single settings row.
   A day with no entry is an "お休み" day.
   ========================================================================== */
(function () {
"use strict";

var STORE_KEY = "vschedule.v1";
var DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
var MAX_DAYS = 31;
var DEFAULT_DAYS = 7;
var DEFAULT_VIEW_COLOR = "#333333"; /* the view's ink — the simple skin's own colour */
var DEFAULT_THEME = "yoko";         /* yoko = simple skin / tate = stacked rows */
var OFF_LABEL = "お休み";
var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
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
	viewColor: DEFAULT_VIEW_COLOR, theme: DEFAULT_THEME
};
var els = {};

function load() {
	state.start = todayISO();
	state.days = DEFAULT_DAYS;
	state.items = {};
	state.viewColor = DEFAULT_VIEW_COLOR;
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
	if (o.theme === "yoko" || o.theme === "tate") state.theme = o.theme;

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
	els.start.value = state.start;
	els.startText.textContent = state.start.replace(/-/g, "/");
	els.count.value = state.days;
	els.viewColor.value = state.viewColor;
	setTheme(state.theme);
}

/* view theme — 横 (simple skin) / 縦 (stacked rows) */
function setTheme(name) {
	state.theme = name === "tate" ? "tate" : "yoko";
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

/* the box is a plain "YYYY/MM/DD" label; the native date input is the picker */
function openPicker() {
	if (typeof els.start.showPicker === "function") {
		try { els.start.showPicker(); return; } catch (e) { /* not allowed here */ }
	}
	els.start.focus();
	els.start.click();
}

function step(delta) {
	state.start = addDays(state.start, delta);
	save();
	syncHeader();
	render();
}

function goToday() {
	state.start = todayISO();
	save();
	syncHeader();
	render();
}

function init() {
	els.rows = document.getElementById("rows");
	els.start = document.getElementById("startDate");
	els.startText = document.getElementById("startDateText");
	els.dateBox = document.getElementById("dateBox");
	els.count = document.getElementById("dayCount");
	els.viewColor = document.getElementById("viewColor");
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

	els.dateBox.addEventListener("click", openPicker);
	els.dateBox.addEventListener("keydown", function (ev) {
		if (ev.key === "Enter" || ev.key === " ") {
			ev.preventDefault();
			openPicker();
		}
	});

	els.dayUp.addEventListener("click", function () { setDays(state.days + 1); });
	els.dayDown.addEventListener("click", function () { setDays(state.days - 1); });

	for (var t = 0; t < els.themeBtns.length; t++) {
		els.themeBtns[t].addEventListener("click", function () {
			setTheme(this.getAttribute("data-theme"));
			save();
			render();
		});
	}

	els.viewColor.addEventListener("input", function () {
		if (!COLOR_RE.test(els.viewColor.value)) return;
		state.viewColor = els.viewColor.value;
		save();
	});

	els.start.addEventListener("change", function () {
		if (!isISO(els.start.value)) { syncHeader(); return; }
		state.start = els.start.value;
		save();
		render();
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
