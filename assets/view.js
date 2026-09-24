/* ==========================================================================
   V-Schedule  /  view
   --------------------------------------------------------------------------
   Reads the same localStorage key as control.html ("vschedule.v1").

   theme "yoko" -> the original SCHEDULIAN "simple" skin, untouched:
                   schedule.simple > inner > .line( .day .dow .time .text )
   theme "tate" -> the same elements stacked in three rows on the same card
                   ( date + weekday / clock / title ), at the SAME font sizes
                   as 横 so switching the theme does not change the size.

   A day with no entry is a rest day ("お休み"): it is dimmed (never made
   transparent) and can be hidden entirely from control's 設定 tab.

   背景 — one flat rounded rectangle is laid behind the elements. Its 始点 is
   the content's own edge, never the centre of the card:
     横 : 中身の左端(日付の左)を左の基準にして、右へ伸ばす。100% = 中身の幅。
     縦 : 3段の上下の中心を基準にして、上下へ同じ距離だけ伸ばす。100% = 3段の高さ。
          横幅を最小(20% = 160px)にして縦幅を最大(110% = 160px)にすると正方形になる。
   So shrinking the gauge never eats into the date on the left, and the 縦
   box always grows/shrinks evenly above and below the three rows.
   It is a separate absolutely-positioned layer drawn with box-sizing:border-box,
   so its edge is crisp, nothing is clipped and the border never shifts it.
   ========================================================================== */
(function () {
"use strict";

var STORE_KEY = "vschedule.v1";
var STYLE_ID = "vschedule-anim";
var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* 横 (skin/simple/style.css) の寸法 — 縦もこの値をそのまま使う */
var LINE_H = 80;            /* px — 横の1行の高さ */
var LINE_H_TATE = 160;      /* px — 縦はカードの高さ全部を使う */
var F_DAY = 66;             /* px — .day  */
var F_DOW = 32;             /* px — .dow  */
var F_TIME = 24;            /* px — .time */
var F_TEXT = 32;            /* px — .text */
var W_TIME_TATE = 16;       /* %  — 縦の時計の幅 */

var SEC_PER_LINE = 8.5714;  /* 60s / 7 lines, the original pace */
var HOLD = 13 / 14;         /* part of each step a line stands still */
var MIN_LOOP = 30;          /* seconds — never spin faster than this */

var DEFAULT_COLOR = "#333333";
var DEFAULT_CLOCK = "#ffffff";  /* 時計の文字の色 */
var DEFAULT_OPACITY = 100;

/* 背景の四角 — 基準(100%)は「中身がちょうど収まるところ」。
   横 : 左の基準 = 中身の左端(BG_PAD)、100% = 中身の幅(BG_W_BASE)。
        上限 = カードの右端まで(左端から 840px = 105%)。
   縦 : 基準 = 3段の上下の中心、100% = 3段の実測の高さ。
        上限 = カードの上下端まで(中心から同じ距離)。
   実寸は描くときに実測するので、数字は「測れなかったとき」の控え。 */
var BG_PAD = 40;            /* px — カードの左右の余白 = 中身の左端 */
var BG_W_BASE = 800;        /* px — 中身の幅 */
var BG_CARD_W = 880;        /* px — カードの外形 */
var BG_CARD_H = 160;
var BG_LINE_H = 80;
var BG_FILL = "#ffffff";
var BG_DEFAULT_FILL = "#ffffff";
var BG_DEFAULT_BORDER_COLOR = "#333333";
var BG_BORDER_W = 3;        /* px — フチの太さ */
var BG_RADIUS = 16;         /* px — 四角の角の丸み */
var BG_MIN_PCT = 40;        /* % — 横の横幅の下限 */
var BG_MIN_W_TATE = 20;     /* % — 縦の横幅の下限 = 160px。
                               縦幅の最大(110% = 160px)と同じなので、
                               「横幅最小 + 縦幅最大」は正方形になる */

var DEFAULT_SHOW_OFF = true;/* 予定のない日(お休み)を出すか */
var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
var OFF_TEXT = "お休み";
window.VS_BUILD = "20260924r";

function pad2(n) { return (n < 10 ? "0" : "") + n; }
function toISO(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function fromISO(s) { var p = String(s).split("-"); return new Date(+p[0], (+p[1]) - 1, +p[2]); }
function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }
function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function todayISO() { return toISO(new Date()); }

function read() {
	var st = {
		start: todayISO(), days: 7, items: {},
		viewColor: DEFAULT_COLOR, clockColor: DEFAULT_CLOCK, viewOpacity: DEFAULT_OPACITY,
		bgOn: false, bgFill: BG_DEFAULT_FILL, bgBorder: true,
		bgBorderColor: BG_DEFAULT_BORDER_COLOR, bgW: 100, bgH: 100,
		showOff: DEFAULT_SHOW_OFF, theme: "yoko"
	};
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
	if (typeof o.clockColor === "string" && COLOR_RE.test(o.clockColor)) st.clockColor = o.clockColor;
	var op = parseInt(o.viewOpacity, 10);
	if (!isNaN(op)) st.viewOpacity = Math.max(0, Math.min(100, op));
	if (typeof o.bgOn === "boolean") st.bgOn = o.bgOn;
	if (typeof o.bgFill === "string" && COLOR_RE.test(o.bgFill)) st.bgFill = o.bgFill;
	if (typeof o.bgBorder === "boolean") st.bgBorder = o.bgBorder;
	if (typeof o.bgBorderColor === "string" && COLOR_RE.test(o.bgBorderColor)) st.bgBorderColor = o.bgBorderColor;
	/* テーマを先に読む — 横幅の下限がテーマで変わるため */
	if (o.theme === "tate") st.theme = "tate";
	/* 横幅/縦幅はテーマごとに別で持つ。旧形式(bgW/bgH しか無い)は
	   いま選んでいるテーマの枠に入れる。 */
	var lo = parseInt(o.bgW, 10), lh = parseInt(o.bgH, 10);
	var tw = parseInt(o.tateBgW, 10), th = parseInt(o.tateBgH, 10);
	if (isNaN(tw) && isNaN(th) && st.theme === "tate") { tw = lo; th = lh; }
	/* 縦は「横幅最小 + 縦幅最大」が正方形になるよう、横幅の下限だけ低い */
	var wMin = st.theme === "tate" ? BG_MIN_W_TATE : BG_MIN_PCT;
	st.bgW = Math.max(wMin, Math.min(110, st.theme === "tate" ? tw : lo));
	st.bgH = Math.max(40, Math.min(110, st.theme === "tate" ? th : lh));
	if (isNaN(st.bgW)) st.bgW = 100;
	if (isNaN(st.bgH)) st.bgH = 100;
	if (typeof o.showOff === "boolean") st.showOff = o.showOff;
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
   A day with no entry still shows its date, marked as a rest day — unless
   control's 設定 tab has お休みの表示 switched off. */
function buildLines(st) {
	var lines = [];
	for (var i = 0; i < st.days; i++) {
		var iso = addDays(st.start, i);
		var d = fromISO(iso);
		var day = String(d.getDate());
		var dow = DOW[d.getDay()];
		var arr = Array.isArray(st.items[iso]) ? st.items[iso] : [];
		if (!arr.length) {
			if (st.showOff === false) continue;   /* お休みは出さない */
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

/* the stack itself — one step per line (80px 横 / 160px 縦) */
function lineKeyframes(n, h) {
	var step = 100 / n, hold = step * HOLD, list = [], i;
	for (i = 0; i < n; i++) {
		var y = -i * h;
		list.push([i * step, y]);
		list.push([i * step + hold, y]);
	}
	list.push([100, 0]);
	return kf(list);
}

/* 縦の3段(日付/時計/タイトル)が実際に使う高さ。
   自分の CSS の定数から出すので、フォントの読み込みやアニメーションに
   左右されない: .l1(66) + 時計(上余白6 + 上下パディング12 + 24) + タイトル(上余白6 + 32) */
var TATE_STACK_H = F_DAY + 6 + (F_TIME + 12) + 6 + F_TEXT;   /* 146 */

/* 背景の四角の基準を出す。
   横 : 左の基準 = 中身(inner)の左端 = 日付の左端。中身の幅が 100%。
        上下は中身の中央。ここは今までどおり一切変えない。
   縦 : 3段(日付/時計/タイトル)が実際に使っている高さと、その上下の中心を
        実測する。中心を四角の中心にするので、上と下の余白は必ず同じになる。
        測り方は offset* なので、アニメーションの transform に影響されない。 */
function measureBox(schedule, cls) {
	var cardRect = schedule.getBoundingClientRect();
	var card = {
		w: schedule.offsetWidth || BG_CARD_W,
		h: schedule.offsetHeight || BG_CARD_H
	};
	var inner = schedule.querySelector("inner");
	var innerL = BG_PAD, innerTop = 0, innerW = BG_W_BASE, innerH = BG_LINE_H;
	if (inner) {
		var ir = inner.getBoundingClientRect();
		innerL = ir.left - cardRect.left;
		innerTop = ir.top - cardRect.top;
		innerW = inner.offsetWidth || BG_W_BASE;
		innerH = inner.offsetHeight || innerH;
	}
	if (cls !== "tate") {
		return { card: card, innerL: innerL, innerW: innerW, contentH: LINE_H, cy: innerTop + innerH / 2 };
	}

	var top = Infinity, bottom = -Infinity;
	var oTop = Infinity, oBottom = -Infinity;
	var lines = schedule.querySelectorAll(".line");
	for (var i = 0; i < lines.length; i++) {
		var lr = lines[i].getBoundingClientRect(), lt = lines[i].offsetTop;
		var kids = lines[i].children;
		for (var j = 0; j < kids.length; j++) {
			var k = kids[j], kr = k.getBoundingClientRect();
			if (!kr.width && !kr.height) continue;   /* お休みで消えている段 */
			/* 行の矩形との引き算なので、行に乗っている transform は打ち消える */
			var y = kr.top - lr.top, b = kr.bottom - lr.top;
			if (y < top) top = y;
			if (b > bottom) bottom = b;
			var oy = k.offsetTop - lt, ob = oy + k.offsetHeight;
			if (oy < oTop) oTop = oy;
			if (ob > oBottom) oBottom = ob;
		}
	}
	if (!isFinite(top) || bottom <= top) {
		top = (innerH - TATE_STACK_H) / 2;
		bottom = top + TATE_STACK_H;
	}
	window.VS_DBG = "tate rect[" + top + "," + bottom + "] off[" + oTop + "," + oBottom + "] innerTop" + innerTop + " ch" + (bottom - top) + " cy" + (innerTop + (top + bottom) / 2);
	return {
		card: card, innerL: innerL, innerW: innerW,
		contentH: bottom - top, cy: innerTop + (top + bottom) / 2
	};
}

/* 背景 — 中身の基準から1枚だけ描く。
   横 : 左端は中身の左端で固定。右へ伸びる(カードの右端で止める)。
   縦 : 左右は中身の中央のまま、3段の中心から上下に同じ距離だけ広げる。
   border-box + 実線ボーダーなので、フチを足しても外形は動かない。 */
function boxCSS(cls, st, g) {
	var w = Math.round(g.innerW * st.bgW / 100);
	var h = Math.round(g.contentH * st.bgH / 100);
	var maxW = cls === "tate" ? g.card.w : (g.card.w - g.innerL);
	var maxH = Math.round(2 * Math.min(g.cy, g.card.h - g.cy));
	if (w > maxW) w = maxW;
	if (h > maxH) h = maxH;
	if (w < 2) w = 2;
	if (h < 2) h = 2;
	if (w % 2) w++;
	if (h % 2) h++;

	var left = Math.round(cls === "tate" ? g.innerL + (g.innerW - w) / 2 : g.innerL);
	if (left < 0) left = 0;
	if (left + w > g.card.w) w = g.card.w - left;
	var top = Math.round(g.cy - h / 2);
	if (top < 0) top = 0;

	var fill = COLOR_RE.test(st.bgFill) ? st.bgFill : BG_DEFAULT_FILL;
	var line = COLOR_RE.test(st.bgBorderColor) ? st.bgBorderColor : BG_DEFAULT_BORDER_COLOR;
	/* フチOFFでも太さは確保しておく(transparent)— 四角の大きさを変えないため */
	var border = BG_BORDER_W + "px solid " + (st.bgBorder ? line : "transparent");
	return "schedule .bgbox{position:absolute;left:" + left + "px;top:" + top + "px;z-index:0;"
		+ "box-sizing:border-box;width:" + w + "px;height:" + h + "px;"
		+ "background:" + fill + ";border:" + border + ";border-radius:" + BG_RADIUS + "px;}";
}

function buildCSS(lines, cls, st, g) {
	var n = lines.length;
	var h = cls === "tate" ? LINE_H_TATE : LINE_H;
	var base = "schedule .line." + cls;
	var reset = "{position:static;top:auto;left:auto;right:auto;bottom:auto;float:none;transform:none;}";
	var css = "";

	if (cls === "tate") {
		css += "schedule.tate inner{width:800px;height:160px;overflow:hidden;}"
			+ base + "{width:100%;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;}"
			+ base + " .l1{display:flex;align-items:baseline;justify-content:center;gap:6px;}"
			+ base + " .day" + reset + base + " .day{font-size:" + F_DAY + "px;font-weight:900;line-height:1em;text-align:center;}"
			+ base + " .dow" + reset + base + " .dow{font-size:" + F_DOW + "px;font-weight:500;line-height:1em;text-align:center;}"
			+ base + " .time" + reset + base + " .time{width:" + W_TIME_TATE + "%;margin:6px 0 0;padding:6px 10px;text-align:center;font-size:" + F_TIME + "px;font-weight:500;line-height:1em;border-radius:10px;overflow:hidden;white-space:nowrap;}"
			+ base + " .text" + reset + base + " .text{max-width:100%;margin:6px 0 0;text-align:center;font-size:" + F_TEXT + "px;font-weight:500;line-height:1em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}"
			+ base + " .time.is-empty," + base + " .text.is-empty{display:none;}";
	}

	/* お休みの日 — 薄くするのではなく暗くする (透過させない) */
	css += "schedule .line.is-off{filter:grayscale(.6) brightness(.55);}"
		+ "schedule .line.is-off .time{display:none;}"
		+ "schedule .line.is-off .text{margin-top:0;}";

	/* 背景の四角はカード直下の1枚。文字より後ろに置く */
	css += "schedule{position:relative;}"
		+ "schedule .line{position:relative;z-index:1;}";
	if (st.bgOn) css += boxCSS(cls, st, g);

	if (n <= 1) {
		css += "schedule .line.vsl{animation:none;}";
		return css;
	}

	var dur = Math.max(MIN_LOOP, n * SEC_PER_LINE);
	css += "@keyframes vslLines{" + lineKeyframes(n, h) + "}";
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

/* 時刻は「ベースカラー」を地にして、文字は「時計文字カラー」 */
function timeCell(value, bg, ink, markEmpty) {
	var p = document.createElement("p");
	p.className = "time" + (markEmpty && value === "" ? " is-empty" : "");
	p.textContent = value;
	if (bg) p.style.background = bg;
	if (ink) p.style.color = ink;
	return p;
}

function textCell(value, color, markEmpty) {
	var p = document.createElement("p");
	p.className = "text" + (markEmpty && value === "" ? " is-empty" : "");
	p.textContent = value;
	if (color) p.style.color = color;
	return p;
}

/* 横 — exactly the simple skin's markup order */
function yokoLine(l, color, clock) {
	var div = document.createElement("div");
	div.className = "line vsl yoko" + (l.off ? " is-off" : "");
	div.appendChild(cell("day", l.day, color));
	div.appendChild(cell("dow", l.dow, color));
	div.appendChild(timeCell(l.time, color, clock, false));
	div.appendChild(textCell(l.text, color, false));
	return div;
}

/* 縦 — date + weekday / clock / title, three rows on the same card */
function tateLine(l, color, clock) {
	var div = document.createElement("div");
	div.className = "line vsl tate" + (l.off ? " is-off" : "");

	var row = document.createElement("div");
	row.className = "l1";
	row.appendChild(cell("day", l.day, color));
	row.appendChild(cell("dow", l.dow, color));

	div.appendChild(row);
	div.appendChild(timeCell(l.time, color, clock, true));
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
		frag.appendChild(cls === "tate" ? tateLine(lines[i], st.viewColor, st.clockColor)
		                                : yokoLine(lines[i], st.viewColor, st.clockColor));
	}
	inner.textContent = "";
	inner.appendChild(frag);

	/* 四角の基準(offsetParent)を決めてから測る */
	schedule.style.position = "relative";
	/* 先にテーマのクラスを入れてから測る — 先に測ると別のレイアウトを測ってしまう */
	schedule.className = cls;
	var g = measureBox(schedule, cls);

	/* 背景の四角はカード直下に1枚だけ */
	var oldBox = schedule.querySelector(".bgbox");
	if (oldBox && oldBox.parentNode) oldBox.parentNode.removeChild(oldBox);
	if (st.bgOn) {
		var box = document.createElement("div");
		box.className = "bgbox";
		schedule.insertBefore(box, schedule.firstChild);
	}

	var old = document.getElementById(STYLE_ID);
	if (old && old.parentNode) old.parentNode.removeChild(old);
	var style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = buildCSS(lines, cls, st, g);
	document.head.appendChild(style);

	schedule.style.opacity = String(st.viewOpacity / 100);
	window.VS_OPACITY = st.viewOpacity;
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
