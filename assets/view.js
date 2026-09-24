/* ==========================================================================
   V-Schedule  /  view
   --------------------------------------------------------------------------
   Reads the same localStorage key as control.html ("vschedule.v1").

   theme "yoko" -> the original SCHEDULIAN "simple" skin, untouched:
                   schedule.simple > inner > .line( .day .dow .time .text )
   theme "tate" -> the same elements, stacked in three rows
                   ( date + weekday / time / title ) on the same card.

   Same-day groups: while the date does not change, the date stays put and
   only the time + title slide. Each date element is counter-translated
   inside its own line with the very same percentage stops as the line, so
   the two movements cancel out during a same-day transition.
   A day with no entry is shown as a rest day ("お休み") in a muted tone.
   ========================================================================== */
(function () {
"use strict";

var STORE_KEY = "vschedule.v1";
var STYLE_ID = "vschedule-anim";
var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var LINE_H = 80;           /* px — the card's inner height, fixed by the skin */
var SEC_PER_LINE = 8.5714; /* 60s / 7 lines, the original pace */
var HOLD = 13 / 14;        /* part of each step a line stands still */
var MIN_LOOP = 30;         /* seconds — never spin faster than this */
var DEFAULT_COLOR = "#333333";
var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
var OFF_TEXT = "お休み";
window.VS_BUILD = "20260924g";

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function toISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function fromISO(s) { var p = String(s).split("-"); return new Date(+p[0], (+p[1]) - 1, +p[2]); }
function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }
function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function todayISO() { return toISO(new Date()); }

function read() {
	var st = { start: todayISO(), days: 7, items: {}, viewColor: DEFAULT_COLOR, theme: "yoko" };
	var raw = null;
	try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return st; }
	if (!raw) return st;

	var o = null;
	try { o = JSON.parse(raw); } catch (e) { return st; }
	if (!o || typeof o !== "object") return st;

	if (isISO(o.start)) st.start = o.start;
	var n = parseInt(o.days, 10);
	if (!isNaN(n)) st.days = Math.max(1, Math.min(31, n));
	if (typeof o.viewColor === "string" && COLOR_RE.test(o.viewColor)) st.viewColor = o.viewColor;
	if (o.theme === "tate") st.theme = "tate";
	if (o.items && typeof o.items === "object" && !Array.isArray(o.items)) {
		for (var k in o.items) {
			if (!Object.prototype.hasOwnProperty.call(o.items, k)) continue;
			if (!isISO(k) || !Array.isArray(o.items[k])) continue;
			var arr = [];
			for (var i = 0; i < o.items[k].length; i++) {
				var it = o.items[k][i] || {};
				arr.push({ t: String(it.t == null ? "" : it.t), x: String(it.x == null ? "" : it.x) });
			}
			if (arr.length) st.items[k] = arr;
		}
	}
	return st;
}

/* one line per entry — every line carries its own date + weekday + time + text.
   A day with no entry still shows its date, marked as a rest day. */
function buildLines(st) {
	var lines = [];
	for (var i = 0; i < st.days; i++) {
		var iso = addDays(st.start, i);
		var d = fromISO(iso);
		var day = String(d.getDate());
		var dow = DOW[d.getDay()];
		var arr = Array.isArray(st.items[iso]) ? st.items[iso] : [];
		if (!arr.length) {
			lines.push({ iso: iso, day: day, dow: dow, time: "", text: OFF_TEXT, off: true });
			continue;
		}
		for (var j = 0; j < arr.length; j++) {
			lines.push({ iso: iso, day: day, dow: dow, time: arr[j].t || "", text: arr[j].x || "", off: false });
		}
	}
	return lines;
}


/* ------------------------------------------------------------- animation */
function kf(list) {
	var out = [];
	for (var i = 0; i < list.length; i++) {
		out.push(list[i][0].toFixed(4) + "%{transform:translateY(" + list[i][1] + "px)}");
	}
	return out.join("");
}

/* the stack itself — one 80px step per line */
function lineKeyframes(n) {
	var step = 100 / n, hold = step * HOLD, list = [], i;
	for (i = 0; i < n; i++) {
		var y = -i * LINE_H;
		list.push([i * step, y]);
		list.push([i * step + hold, y]);
	}
	list.push([100, 0]);
	return kf(list);
}

function buildCSS(lines, cls) {
	var n = lines.length;
	var base = "schedule .line." + cls;
	var reset = "{position:static;top:auto;left:auto;right:auto;bottom:auto;float:none;transform:none;}";
	var css = "";

	if (cls === "tate") {
		css += base + "{width:100%;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;}"
			+ base + " .l1{display:flex;align-items:baseline;justify-content:center;gap:2px;}"
			+ base + " .day" + reset + base + " .day{font-size:25px;font-weight:900;line-height:1em;text-align:center;}"
			+ base + " .dow" + reset + base + " .dow{font-size:14px;font-weight:500;line-height:1em;text-align:center;}"
			+ base + " .time" + reset + base + " .time{width:9%;margin-top:4px;padding:3px 16px 4px;text-align:center;color:#fff;font-size:16px;font-weight:500;line-height:1em;border-radius:9px;overflow:hidden;white-space:nowrap;}"
			+ base + " .text" + reset + base + " .text{max-width:100%;margin-top:5px;text-align:center;font-size:20px;font-weight:700;line-height:1.1em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}"
			+ base + " .time.is-empty," + base + " .text.is-empty{display:none;}";
	}

	css += "schedule .line.is-off{filter:grayscale(.55) opacity(.55);}"
		+ "schedule .line.is-off .time{display:none;}"
		+ "schedule .line.is-off .text{margin-top:0;}";

	if (n <= 1) {
		css += "schedule .line.vsl{animation:none;}";
		return css;
	}

	var dur = Math.max(MIN_LOOP, n * SEC_PER_LINE);
	css += "@keyframes vslLines{" + lineKeyframes(n) + "}";
	css += "schedule .line.vsl{animation-name:vslLines;animation-duration:" + dur.toFixed(2) +
		"s;animation-timing-function:ease;animation-iteration-count:infinite;}";
	return css;
}

/* ----------------------------------------------------------- line builders */
function cell(cls, value, color) {
	var p = document.createElement("p");
	p.className = cls;
	p.textContent = value;
	if (color) p.style.color = color;
	return p;
}

function timeCell(value, color, markEmpty) {
	var p = document.createElement("p");
	p.className = "time" + (markEmpty && value === "" ? " is-empty" : "");
	p.textContent = value;
	p.style.background = color;
	return p;
}

function textCell(value, color, markEmpty) {
	var p = document.createElement("p");
	p.className = "text" + (markEmpty && value === "" ? " is-empty" : "");
	p.textContent = value;
	p.style.color = color;
	return p;
}

/* 横 — exactly the simple skin's markup order */
function yokoLine(l, color) {
	var div = document.createElement("div");
	div.className = "line vsl yoko" + (l.off ? " is-off" : "");
	div.appendChild(cell("day", l.day, color));
	div.appendChild(cell("dow", l.dow, color));
	div.appendChild(timeCell(l.time, color, false));
	div.appendChild(textCell(l.text, color, false));
	return div;
}

/* 縦 — date + weekday / time / title, three rows on the same card */
function tateLine(l, color) {
	var div = document.createElement("div");
	div.className = "line vsl tate" + (l.off ? " is-off" : "");

	var row = document.createElement("div");
	row.className = "l1";
	row.appendChild(cell("day", l.day, color));
	row.appendChild(cell("dow", l.dow, color));

	div.appendChild(row);
	div.appendChild(timeCell(l.time, color, true));
	div.appendChild(textCell(l.text, color, true));
	return div;
}

function build() {
	var schedule = document.querySelector("schedule");
	if (!schedule) return;
	var inner = schedule.querySelector("inner");
	if (!inner) return;

	var st = read();
	var cls = st.theme === "tate" ? "tate" : "simple";
	var lines = buildLines(st);

	var frag = document.createDocumentFragment();
	for (var i = 0; i < lines.length; i++) {
		frag.appendChild(cls === "tate" ? tateLine(lines[i], st.viewColor)
		                                : yokoLine(lines[i], st.viewColor));
	}
	inner.textContent = "";
	inner.appendChild(frag);

	var old = document.getElementById(STYLE_ID);
	if (old && old.parentNode) old.parentNode.removeChild(old);
	var style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = buildCSS(lines, cls);
	document.head.appendChild(style);

	schedule.className = cls;
}

function start() {
	build();
	window.addEventListener("storage", function (ev) {
		if (ev.key && ev.key !== STORE_KEY) return;
		build();
	});
	window.addEventListener("focus", build);
	document.addEventListener("visibilitychange", function () {
		if (!document.hidden) build();
	});
}

document.addEventListener("DOMContentLoaded", start);
})();
