// HermiteCut — core UI helpers
(function () {
    'use strict';
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

    const P = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${d}</svg>`;
    const ICONS = {
        pin: P('<path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4z"/>'),
        refresh: P('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
        gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
        minus: P('<path d="M5 12h14"/>'),
        x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
        ease: P('<path d="M4 20C10 20 9 4 20 4"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/>'),
        align: P('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>'),
        grid: P('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'),
        motion: P('<path d="M3 12h4M5 7h5M5 17h5"/><rect x="12" y="6" width="9" height="12" rx="2"/>'),
        bounce: P('<path d="M3 18c3 0 3-12 6-12s3 12 6 12 2-6 4-6 1 6 2 6"/>'),
        beat: P('<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>'),
        caption: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h4M13 12h4M7 15h8"/>'),
        plus: P('<path d="M12 5v14M5 12h14"/>'),
        undo: P('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
        swap: P('<path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>'),
        copy: P('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
        paste: P('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>'),
        bolt: P('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
        play: P('<path d="M7 4l13 8-13 8z"/>'),
        trash: P('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
        folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
        wave: P('<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>'),
        marker: P('<path d="M6 3h12v13l-6 5-6-5z"/>'),
        spark: P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5z"/>'),
        speaker: P('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>'),
        phone: P('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
        wrench: P('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
        sliders: P('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')
    };

    function hydrateIcons(root) {
        $$('[data-icon]', root).forEach(el => {
            const ic = ICONS[el.dataset.icon];
            if (!ic) return;
            if (el.tagName === 'SPAN' && el.parentElement && (el.parentElement.classList.contains('cta') || el.parentElement.classList.contains('btn'))) {
                el.outerHTML = ic;
            } else if (!el.querySelector('svg')) {
                el.insertAdjacentHTML('afterbegin', ic);
            }
        });
    }

    // ---- storage
    const store = {
        get(k, d) { try { const v = localStorage.getItem('hc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('hc.' + k, JSON.stringify(v)); } catch (e) { /* */ } },
        clear() { try { Object.keys(localStorage).filter(k => k.startsWith('hc.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* */ } }
    };

    // ---- toast
    function toast(msg, kind) {
        const t = document.createElement('div');
        t.className = 'toast ' + (kind || 'ok');
        t.innerHTML = '<span class="d"></span><span></span>';
        t.lastChild.textContent = msg;
        $('#toasts').appendChild(t);
        const life = kind === 'err' ? 6000 : 3200;
        setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, life);
        while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    }

    // ---- calls into Resolve
    async function call(name, args, opts) {
        opts = opts || {};
        const btn = opts.button;
        let prev;
        if (btn) { prev = btn.innerHTML; btn.disabled = true; if (btn.classList.contains('cta')) btn.innerHTML = '<span class="busy-spin"></span>' + (opts.busyText || 'Working…'); }
        try {
            const r = await window.hermite.call(name, args);
            if (!r || !r.ok) throw new Error((r && r.error) || 'Unknown error');
            if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r.result) : opts.success);
            else if (r.result && r.result.msg) toast(r.result.msg);
            return r.result;
        } catch (e) {
            if (!opts.silent) toast(e.message.replace(/^Error:\s*/, ''), 'err');
            throw e;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = prev; }
            if (!opts.noRefresh) setTimeout(poll, 250);
        }
    }

    // ---- segmented controls
    function seg(el, onChange, initial) {
        const btns = $$('button', el);
        const set = (v, fire) => {
            btns.forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
            if (fire && onChange) onChange(String(v));
        };
        btns.forEach(b => b.addEventListener('click', () => set(b.dataset.v, true)));
        if (initial !== undefined) set(initial, false);
        return { get: () => (btns.find(b => b.classList.contains('on')) || btns[0]).dataset.v, set };
    }

    // ---- ranges: paint fill + label
    function range(el, label, fmt, onInput) {
        const paint = () => {
            const p = (el.value - el.min) / (el.max - el.min) * 100;
            el.style.setProperty('--p', p + '%');
            if (label) label.textContent = fmt ? fmt(+el.value) : el.value;
        };
        el.addEventListener('input', () => { paint(); if (onInput) onInput(+el.value); });
        paint();
        return paint;
    }

    // ---- tooltip
    function tips() {
        const tip = $('#tip');
        let timer = null;
        document.addEventListener('mouseover', (e) => {
            const el = e.target.closest('[data-tip]');
            clearTimeout(timer);
            if (!el) { tip.style.display = 'none'; return; }
            timer = setTimeout(() => {
                tip.textContent = el.dataset.tip;
                tip.style.display = 'block';
                const r = el.getBoundingClientRect();
                const tw = tip.offsetWidth, th = tip.offsetHeight;
                let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 6;
                if (y + th > innerHeight - 4) y = r.top - th - 6;
                x = Math.max(4, Math.min(innerWidth - tw - 4, x));
                tip.style.left = x + 'px'; tip.style.top = y + 'px';
            }, 380);
        });
        document.addEventListener('mousedown', () => { clearTimeout(timer); tip.style.display = 'none'; });
    }

    // ---- status polling
    let lastStatus = null;
    let polling = false;
    const listeners = [];
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const r = await window.hermite.call('status');
            const dot = $('#ctxDot'), main = $('#ctxMain'), sel = $('#ctxSel');
            if (r && r.ok) {
                const s = r.result;
                lastStatus = s;
                dot.classList.add('ok');
                const bits = [];
                if (s.project) bits.push('<b>' + esc(s.project) + '</b>');
                if (s.timeline) bits.push(esc(s.timeline));
                if (s.fps) bits.push(s.fps + ' fps');
                if (s.width) bits.push(s.width + '×' + s.height);
                if (s.page) bits.push(s.page.charAt(0).toUpperCase() + s.page.slice(1) + ' page');
                if (s.tc) bits.push(s.tc);
                main.innerHTML = bits.length ? bits.join(' · ') : 'Connected · open a project';
                sel.innerHTML = s.timeline ? '<b>' + (s.selected || 0) + '</b> selected' : '';
            } else {
                lastStatus = null;
                dot.classList.remove('ok');
                main.textContent = 'Not connected to Resolve — ' + ((r && r.error) || '');
                sel.textContent = '';
            }
            listeners.forEach(fn => { try { fn(lastStatus); } catch (e) { /* */ } });
        } catch (e) { /* ignore */ }
        polling = false;
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ---- canvas helper (hi-dpi)
    function fitCanvas(cv) {
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
            cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, w, h };
    }
    function accent() { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b9acff'; }

    // shared state between modules
    const shared = { curve: store.get('ease.curve', [0.25, 0.1, 0.25, 1]), curveName: store.get('ease.name', 'Ease'), curveListeners: [] };
    shared.setCurve = (c, name) => {
        shared.curve = c; shared.curveName = name || 'Custom';
        store.set('ease.curve', c); store.set('ease.name', shared.curveName);
        shared.curveListeners.forEach(f => f(c, shared.curveName));
    };

    window.HC = { $, $$, ICONS, hydrateIcons, store, toast, call, seg, range, tips, poll, fitCanvas, accent, esc, shared,
        onStatus: (fn) => listeners.push(fn), status: () => lastStatus };

    // ---- shell wiring
    document.addEventListener('DOMContentLoaded', () => {
        hydrateIcons(document);
        tips();

        // window buttons
        if (new URLSearchParams(location.search).get('lights') === 'native') document.documentElement.classList.add('native-lights');
        $('#btnClose').onclick = () => window.hermite.win('close');
        $('#btnMin').onclick = () => window.hermite.win('minimize');
        $('#btnZoom').onclick = () => window.hermite.win('zoom');
        // double-clicking the title bar zooms, as on macOS
        $('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button, .sets')) window.hermite.win('zoom'); });
        const pinBtn = $('#btnPin');
        const pinned = store.get('pin', true);
        window.hermite.win('pin', pinned).then(v => pinBtn.classList.toggle('on', !!v));
        pinBtn.onclick = async () => {
            const v = await window.hermite.win('pin', !pinBtn.classList.contains('on'));
            pinBtn.classList.toggle('on', !!v); store.set('pin', !!v);
        };
        $('#btnRefresh').onclick = () => { poll(); toast('Refreshed', 'info'); };

        // tool sets
        const applySet = (set) => {
            const custom = store.get('mainSet', null);
            $$('#sets button').forEach(b => b.classList.toggle('on', b.dataset.set === set));
            $$('.card').forEach(c => {
                let show = c.dataset.sets.split(',').includes(set);
                if (set === 'main' && custom) show = custom.includes(c.dataset.mod);
                c.classList.toggle('hidden', !show);
            });
            store.set('set', set);
            setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
        };
        $$('#sets button').forEach(b => b.onclick = () => applySet(b.dataset.set));
        HC.applySet = applySet;
        applySet(store.get('set', 'main'));

        poll();
        setInterval(() => { if (!document.hidden) poll(); }, 2500);
    });
})();
