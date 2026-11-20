'use strict';

/* =====================================================================
   1. Utilities
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const softplus = (x, k = 2) => Math.log1p(Math.exp(k * x)) / k;
const SVG_NS = 'http://www.w3.org/2000/svg';

function erf(x) {
    const s = Math.sign(x);
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));

function fmtClock(s) {
    s = Math.floor(s);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor(s / 60) % 60).padStart(2, '0');
    return `${h}:${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtPa(p) {
    if (p >= 1000) return (p / 1000).toFixed(p >= 10000 ? 0 : 1) + ' kPa';
    if (p >= 1) return p.toFixed(1) + ' Pa';
    return p.toExponential(1) + ' Pa';
}

function svg(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Approximate visible-spectrum colour for a wavelength in nm.
function wlColor(wl, a = 1) {
    let r = 0, g = 0, b = 0;
    if (wl < 380) { r = 0.5; b = 0.8; }
    else if (wl < 440) { r = -(wl - 440) / 60; b = 1; }
    else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
    else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
    else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
    else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
    else { r = 1; }
    if (wl > 700) r = Math.max(0.45, 1 - (wl - 700) / 200);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/* =====================================================================
   2. Physical constants, gases, recipes
   ===================================================================== */
const L_MM = 200;          // shower plate to wafer distance
const B_PER_A = 40;        // peak on-axis field per coil amp (G/A)
const COIL_MAX_A = 27;
const B_ECR = 875;         // resonance field for 2.45 GHz
// zc = coil centre (mm below window), a = effective coil radius (mm)
const COILS = [
    { name: 'Upper', short: 'U', zc: 22, a: 60 },
    { name: 'Middle', short: 'M', zc: 63, a: 60 },
    { name: 'Lower', short: 'L', zc: 132, a: 80 },
];
const P_ATM = 101325;
const P_LL_VAC = 5;

const GASES = {
    Cl2: { react: 1.0, pass: 0.0 },
    HBr: { react: 0.6, pass: 0.35 },
    O2: { react: 0.1, pass: 4.0 },
    CF4: { react: 0.8, pass: 0.2 },
    CHF3: { react: 0.35, pass: 1.2 },
    Ar: { react: 0.0, pass: 0.0 },
    BCl3: { react: 0.5, pass: 0.4 },
    CH3F: { react: 0.45, pass: 1.0 },
    NF3: { react: 1.2, pass: 0.0 },
    SF6: { react: 1.3, pass: 0.0 },
    He: { react: 0.0, pass: 0.0 },
    N2: { react: 0.05, pass: 0.1 },
    H2: { react: 0.1, pass: 0.3 },
    CH4: { react: 0.1, pass: 1.2 },
    CO2: { react: 0.05, pass: 0.6 },
    SO2: { react: 0.05, pass: 0.8 },
    SiCl4: { react: 0.3, pass: 1.0 },
    SiF4: { react: 0.1, pass: 0.8 },
};

// tp = generic timed plasma step (ash, plasma dechuck, …) that does not etch the film
const PLASMA_STEPS = ['bt', 'me', 'oe', 'tp'];

const RECIPES = {
    poly: {
        name: 'Poly-Si gate etch', chem: 'Cl2 / HBr / O2',
        film: { name: 'Poly-Si', thick: 150, eth: 16, color: '#8fa0b5' },
        under: { name: 'Gate SiO2', thick: 2.0, eth: 60, color: '#e0b84a' },
        nominal: { er: 280, sel: 90 },
        kChem: 0.10,
        hw: { coils: [20, 18, 8], he: 1000 },
        epd: { species: 'SiCl', wl: 405, drop: 0.35, maxTime: 120 },
        glow: [200, 130, 255],
        lines: [
            { wl: 288, sp: 'Si', k: 0.5, src: 'prod' },
            { wl: 405, sp: 'SiCl', k: 1.0, src: 'prod' },
            { wl: 486, sp: 'Hβ', k: 0.3, src: 'HBr' },
            { wl: 656, sp: 'Hα', k: 0.7, src: 'HBr' },
            { wl: 725, sp: 'Cl', k: 0.8, src: 'Cl2' },
            { wl: 754, sp: 'Cl', k: 0.6, src: 'Cl2' },
            { wl: 777, sp: 'O', k: 0.5, src: 'O2' },
            { wl: 685, sp: 'F', k: 0.6, src: 'CF4' },
        ],
        steps: [
            { type: 'base', name: 'Base pressure check', dur: 3 },
            { type: 'stab', name: 'Gas stabilize', dur: 5 },
            { type: 'ignite', name: 'Plasma ignite / tune', dur: 2 },
            { type: 'bt', name: 'Breakthrough', dur: 6, mw: 800, bias: 60, p: 0.4, gases: { CF4: 50 } },
            { type: 'me', name: 'Main etch (EPD)', mw: 900, bias: 50, p: 0.5, gases: { Cl2: 60, HBr: 90, O2: 3 } },
            { type: 'oe', name: 'Over-etch', overPct: 40, mw: 700, bias: 15, p: 1.0, gases: { HBr: 120, O2: 4 } },
            { type: 'purge', name: 'Plasma off / purge', dur: 4 },
            { type: 'dechuck', name: 'ESC dechuck / lift', dur: 3 },
        ],
    },
    al: {
        name: 'Al-Cu metal etch', chem: 'BCl3 / Cl2',
        film: { name: 'Al-Cu', thick: 500, eth: 10, color: '#c9ced6' },
        under: { name: 'TiN barrier', thick: 30, eth: 80, color: '#b98a5a' },
        nominal: { er: 650, sel: 6 },
        kChem: 0.15,
        hw: { coils: [21, 19, 9], he: 800 },
        epd: { species: 'Al', wl: 396, drop: 0.35, maxTime: 150 },
        glow: [110, 230, 200],
        lines: [
            { wl: 396, sp: 'Al', k: 1.0, src: 'prod' },
            { wl: 309, sp: 'Al', k: 0.5, src: 'prod' },
            { wl: 261, sp: 'AlCl', k: 0.4, src: 'prod' },
            { wl: 272, sp: 'BCl', k: 0.6, src: 'BCl3' },
            { wl: 725, sp: 'Cl', k: 0.8, src: 'Cl2' },
            { wl: 754, sp: 'Cl', k: 0.6, src: 'Cl2' },
        ],
        steps: [
            { type: 'base', name: 'Base pressure check', dur: 3 },
            { type: 'stab', name: 'Gas stabilize', dur: 5 },
            { type: 'ignite', name: 'Plasma ignite / tune', dur: 2 },
            { type: 'bt', name: 'Breakthrough (Al2O3)', dur: 8, mw: 800, bias: 90, p: 0.6, gases: { BCl3: 80, Cl2: 20 } },
            { type: 'me', name: 'Main etch (EPD)', mw: 1000, bias: 70, p: 0.8, gases: { BCl3: 40, Cl2: 100 } },
            { type: 'oe', name: 'Over-etch', overPct: 30, mw: 900, bias: 50, p: 0.8, gases: { BCl3: 40, Cl2: 60 } },
            { type: 'purge', name: 'Plasma off / purge', dur: 6 },
            { type: 'dechuck', name: 'ESC dechuck / lift', dur: 3 },
        ],
    },
    ox: {
        name: 'SiO2 contact etch', chem: 'CF4 / CHF3 / Ar',
        film: { name: 'SiO2', thick: 300, eth: 40, color: '#7fb2d9' },
        under: { name: 'Si (recess)', thick: 10, eth: 70, color: '#8fa0b5' },
        nominal: { er: 320, sel: 12 },
        kChem: 0.03,
        hw: { coils: [22, 14, 6], he: 1200 },
        epd: { species: 'CO', wl: 483, drop: 0.30, maxTime: 150 },
        glow: [110, 140, 255],
        lines: [
            { wl: 483, sp: 'CO', k: 1.0, src: 'prod' },
            { wl: 520, sp: 'CO', k: 0.4, src: 'prod' },
            { wl: 685, sp: 'F', k: 0.6, src: 'CF4' },
            { wl: 516, sp: 'C2', k: 0.3, src: 'CHF3' },
            { wl: 750, sp: 'Ar', k: 0.9, src: 'Ar' },
            { wl: 811, sp: 'Ar', k: 0.7, src: 'Ar' },
        ],
        steps: [
            { type: 'base', name: 'Base pressure check', dur: 3 },
            { type: 'stab', name: 'Gas stabilize', dur: 5 },
            { type: 'ignite', name: 'Plasma ignite / tune', dur: 2 },
            { type: 'me', name: 'Main etch (EPD)', mw: 1200, bias: 150, p: 0.3, gases: { CF4: 20, CHF3: 40, Ar: 100 } },
            { type: 'oe', name: 'Over-etch', overPct: 25, mw: 1100, bias: 110, p: 0.3, gases: { CHF3: 50, Ar: 100 } },
            { type: 'purge', name: 'Plasma off / purge', dur: 4 },
            { type: 'dechuck', name: 'ESC dechuck / lift', dur: 3 },
        ],
    },
};
const RECIPE_DEFAULTS = JSON.parse(JSON.stringify(RECIPES));

const meStep = r => r.steps.find(s => s.type === 'me');

/* =====================================================================
   3. Physics model (illustrative, not quantitative)
   ===================================================================== */
const coilField = (z, i, amps) => B_PER_A * amps / Math.pow(1 + ((z - COILS[i].zc) / COILS[i].a) ** 2, 1.5);
const bField = (z, coils) => coilField(z, 0, coils[0]) + coilField(z, 1, coils[1]) + coilField(z, 2, coils[2]);

// First 875 G crossing below the window; a high-field launch (B(0) >= 875 G) absorbs most efficiently
function resonance(coils) {
    let prev = bField(0, coils);
    const highField = prev >= B_ECR;
    for (let z = 1; z <= L_MM; z++) {
        const b = bField(z, coils);
        if ((prev - B_ECR) * (b - B_ECR) < 0) return { z: z - 1 + (prev - B_ECR) / (prev - b), highField };
        prev = b;
    }
    return null;
}

function resonanceZ(coils) {
    const r = resonance(coils);
    return r ? r.z : null;
}

function plasmaRaw(recipe, s, coils, he) {
    const res = resonance(coils);
    const zres = res ? res.z : null;
    const bW = bField(L_MM, coils);
    // flux-tube expansion from the ECR zone to the wafer (r ∝ 1/√B)
    const X = clamp(B_ECR / Math.max(bW, 20), 0.5, 40);
    const ok = zres !== null && zres < L_MM - 5 && s.p >= 0.05 && s.p <= 3 && s.mw >= 150;
    const launch = res && res.highField ? 1 : 0.55;
    const pf = s.p / (s.p + 0.15) * Math.exp(-s.p / 2.5);
    const nRes = ok ? 1.6 * Math.pow(s.mw / 1000, 0.85) * pf * launch : 0;
    const lam = 90 / Math.pow(s.p, 0.35);
    const nW = ok ? nRes * (0.35 + 0.65 * Math.exp(-(L_MM - zres) / lam)) * 1.5 / (1 + X / 8) : 0;

    let R = 0, P = 0, Ar = 0;
    for (const g in s.gases) {
        const f = s.gases[g];
        R += f * GASES[g].react;
        P += f * GASES[g].pass;
        if (g === 'Ar') Ar += f;
    }

    // P_bias ≈ Vdc · I_ion, so higher density lowers self-bias at fixed power
    const vdc = nW > 0 && s.bias > 0 ? Math.min(900, 1.6 * s.bias / Math.sqrt(Math.max(nW, 0.05))) : 0;
    const eIon = nW > 0 ? 15 + vdc : 0;
    const flux = nW * (1 + 0.004 * Ar);
    const rad = nW > 0 ? (R / 100) * (nW / (nW + 0.3)) * (s.p / (s.p + 0.4)) : 0;

    const heat = nW > 0 ? 0.018 * s.mw + 0.12 * s.bias : 0;
    const tW = 20 + heat / (0.12 + he / (he + 500));
    const tf = Math.exp((tW - 50) / 60);

    const yF = nW > 0 ? softplus(Math.sqrt(eIon) - Math.sqrt(recipe.film.eth)) : 0;
    const ionTerm = flux * yF;
    const chem = recipe.kChem * rad * tf;
    const erRaw = ionTerm * rad / (rad + 0.15 * ionTerm + 1e-9) + chem;

    const theta = P / (P + R * 0.6 + 5);
    const lateral = chem * (1 - theta) * (1 + 0.8 * s.p) + erRaw * 0.02 * s.p;
    const anis = erRaw > 0 ? clamp(1 - lateral / erRaw, 0, 1) : 0;
    const angle = erRaw > 0 ? 90 - Math.atan(lateral / erRaw) * 180 / Math.PI : 0;

    const yU = nW > 0 ? softplus(Math.sqrt(eIon) - Math.sqrt(recipe.under.eth)) : 0;
    const underRaw = flux * yU * (1 - 0.6 * theta) + 0.002 * rad + 1e-6;

    let uni = 1.2 + (zres !== null ? 10 * Math.pow((zres - 95) / L_MM, 2) + 4 * Math.exp(-(L_MM - zres) / 15) : 0)
        + 2.5 * Math.log(X / 4) ** 2
        + 1.2 * Math.max(0, s.p - 0.7) + 2.5 * Math.exp(-he / 250) + 0.004 * s.bias;
    uni = clamp(uni, 0.5, 20);

    const refl = 2 + 3 * Math.abs(Math.log(s.p / 0.5)) + (s.mw > 1300 ? (s.mw - 1300) / 100 : 0);

    return {
        zres, highField: !!(res && res.highField), b0: bField(0, coils), bW, X, ok, nRes, nW, vdc, eIon, flux, rad, tW,
        erRaw, selRaw: erRaw / underRaw, anis, angle, uni, refl, theta,
    };
}

// Scale factors so the default recipe hits its nominal etch rate & selectivity
function calibrate(key) {
    const r = RECIPES[key], d = RECIPE_DEFAULTS[key];
    const raw = plasmaRaw(d, meStep(d), d.hw.coils, d.hw.he);
    r._erScale = d.nominal.er / raw.erRaw;
    r._selScale = d.nominal.sel / raw.selRaw;
}

function plasmaModel(recipe, s, coils, he) {
    const m = plasmaRaw(recipe, s, coils, he);
    m.er = m.erRaw * recipe._erScale;
    m.sel = clamp(m.selRaw * recipe._selScale, 1, 999);
    return m;
}

function modelReason(m, s) {
    if (m.zres === null) {
        return m.bW >= B_ECR
            ? `B ≥ 875 G all the way to the wafer (${m.bW.toFixed(0)} G) — resonance pushed below wafer`
            : 'B never reaches 875 G — no ECR resonance in chamber';
    }
    if (m.zres >= L_MM - 5) return 'ECR zone at/below wafer';
    if (s.p < 0.05 || s.p > 3) return `pressure ${s.p} Pa outside ignition window`;
    if (s.mw < 150) return 'microwave power too low';
    return 'unknown';
}

/* =====================================================================
   4. Faults & explainer content
   ===================================================================== */
const FAULTS = {
    MW_REFL: {
        code: 'PM-101', title: 'Microwave reflected power high', target: 'pm',
        cause: 'Auto-tuner cannot match the plasma load: stub motor stuck, arcing in the waveguide, or heavy deposits on the quartz window.',
        action: 'Check tuner stub positions & motors, inspect waveguide for arc marks, inspect quartz window; season or wet-clean if coated.',
    },
    IGN_FAIL: {
        code: 'PM-102', title: 'Plasma ignition failure', target: 'pm',
        cause: 'No OES emission after µW on. ECR zone outside chamber (coil current too low), pressure outside ignition window, or magnetron fault.',
        action: 'Verify coil current gives B ≥ 875 G in the discharge region, check pressure, magnetron anode current and filament hours.',
    },
    COIL_TRIP: {
        code: 'PM-103', title: 'Solenoid coil PSU trip', target: 'pm',
        cause: 'Coil supply tripped (over-temperature / low cooling-water flow). Field collapses, resonance is lost and the plasma extinguishes.',
        action: 'Check coil cooling-water flow & interlocks and PSU fault log; reset, then run a test wafer.',
    },
    PRESS_TOL: {
        code: 'PM-201', title: 'Chamber pressure out of tolerance', target: 'pm',
        cause: 'APC valve cannot reach setpoint: valve stuck, turbo pump degraded, or chamber leak.',
        action: 'Compare APC position vs setpoint, check TMP speed/current, perform rate-of-rise leak check.',
    },
    MFC_DEV: {
        code: 'PM-202', title: 'MFC flow deviation', target: 'pm',
        cause: 'Gas flow differs >5 % from setpoint: MFC drift, clogged line, or low supply pressure.',
        action: 'Check gas supply pressure, run MFC rate-of-rise verification, replace MFC if drifted.',
    },
    HE_LEAK: {
        code: 'PM-301', title: 'He backside leak / ESC clamp error', target: 'pm',
        cause: 'He flow above limit at pressure setpoint: wafer not clamped (bowed wafer, particle under wafer, worn ESC).',
        action: 'Inspect and clean ESC surface, check wafer bow, ESC voltage & leakage current; quarantine the wafer.',
    },
    TEMP_HIGH: {
        code: 'PM-302', title: 'Wafer temperature high', target: 'pm', natural: true,
        cause: 'Heat load exceeds backside cooling capacity (low He pressure or very high µW/bias power).',
        action: 'Restore He backside pressure, reduce bias/µW power, verify chiller setpoint.',
    },
    EPD_TIMEOUT: {
        code: 'PM-401', title: 'Endpoint not detected (timeout)', target: 'pm',
        cause: 'OES signal never fell below threshold: OES window clouded, wrong wavelength, film thicker than expected or etch rate too low.',
        action: 'Clean/replace OES window, check spectrometer & wavelength, verify incoming thickness and etch rate; disposition the wafer.',
    },
    ROBOT_ERR: {
        code: 'TR-501', title: 'Robot wafer presence error', target: 'robot',
        cause: 'End-effector sensor lost the wafer during transfer: wafer slid, mis-seated in station, or sensor fault.',
        action: 'Stop and inspect visually, confirm wafer seating, re-teach station if offset, then resume.',
    },
    LL_PUMP: {
        code: 'LL-601', title: 'Load lock pump-down timeout', target: 'll',
        cause: 'Load lock did not reach transfer pressure in time: door O-ring leak, vent valve not closed, roughing pump/valve issue.',
        action: 'Check door seal & O-ring, vent valve, roughing line; leak-check before resuming.',
    },
};

const TOPICS = {
    overview: {
        t: 'MME ECR dry etcher — overview',
        h: `<p>A single-wafer, multi-chamber <b>dry etch</b> platform using <b>ECR (electron cyclotron resonance)</b> microwave plasma sources.</p>
<ul><li><b>5 load ports</b> → atmospheric EFEM robot → <b>2 load locks</b></li>
<li><b>3 vacuum transfer modules</b> in series, linked by pass-through buffers</li>
<li>Each TM serves <b>2 ECR chambers</b> (PM1–PM6)</li></ul>
<p>Try it:</p><ul>
<li><b>Load &amp; run lot</b> to process wafers; click a PM to watch it.</li>
<li>Hover/click chamber parts for explanations.</li>
<li>Move the <b>recipe knobs</b> and watch etch rate, selectivity, anisotropy.</li>
<li><b>Inject faults</b> and practise recovery.</li></ul>`,
    },
    lp: {
        t: 'Load ports & FOUPs',
        h: `<p>Each load port docks a 25-slot <b>FOUP</b>, opens its door inside the EFEM and maps slot occupancy.</p>
<p>Wafers are dispatched in slot order and always return to their <b>original slot</b>. Slot colours: grey = waiting, purple = in tool, green = processed, red = aborted.</p>`,
    },
    efem: {
        t: 'EFEM & atmospheric robot',
        h: `<p>The <b>Equipment Front-End Module</b> is a filtered mini-environment at atmospheric pressure. Its track robot moves wafers between FOUPs and the load locks (an aligner, not shown, finds the notch).</p>
<p>Scheduler priority: <b>unload processed wafers first</b>, then load new ones.</p>`,
    },
    ll: {
        t: 'Load locks',
        h: `<p>Airlocks between atmosphere and vacuum. After loading, a load lock is <b>roughed from 101 kPa to ~5 Pa</b> (~8 s) before the vacuum robot may open it; outbound wafers are <b>vented with N₂</b>.</p>
<p>Two load locks alternate so pump/vent overhead is hidden behind processing. A slow pump-down usually means a door O-ring leak or a valve problem.</p>`,
    },
    tm: {
        t: 'Vacuum transfer modules (linear)',
        h: `<p>Three TMs in series, each with a vacuum robot serving two PMs. Wafers for PM5/PM6 make three hops each way through the buffers.</p>
<p>Scheduling rules used here:</p><ul>
<li>Each lot runs on a <b>chamber pair</b> (PM1&amp;2, PM3&amp;4 or PM5&amp;6, the two chambers on one TM), alternating wafers between them. <i>Auto</i> picks the least-loaded healthy pair.</li>
<li>A PM is <b>reserved at dispatch</b>, so wafers in transit always have a free chamber.</li>
<li>Lots on different pairs dispatch independently; one busy pair never holds up another.</li>
<li>Robots move <b>outbound wafers first</b> to free chambers quickly.</li>
<li>Buffers have separate in/out slots so two-way traffic never deadlocks.</li></ul>`,
    },
    buf: {
        t: 'Pass-through buffers',
        h: `<p>Vacuum stations between adjacent TMs. The upper slot carries <b>inbound</b> wafers, the lower slot <b>outbound</b> wafers.</p>`,
    },
    pm: {
        t: 'ECR process module',
        h: `<p><b>2.45 GHz microwaves</b> pass through a waveguide and quartz window into a discharge region surrounded by <b>solenoid coils</b>.</p>
<p>Where |B| = <b>875 G</b>, electrons gyrate in resonance with the wave and absorb its energy, producing a <b>dense plasma at low pressure</b>.</p>
<p>The wafer sits on an <b>electrostatic chuck</b> with its own <b>RF bias</b>, so ion <i>energy</i> is controlled independently of ion <i>density</i>. This decoupling is the main advantage of ECR.</p>`,
    },
    magnetron: {
        t: 'Magnetron (2.45 GHz)',
        h: `<p>Generates CW microwave power (typ. 200–1500 W). µW power mainly controls <b>plasma density</b> (ion flux) and <b>radical generation</b>, not ion energy.</p>
<p>An isolator protects the magnetron from reflected power; an auto-tuner matches the plasma load.</p>
<p class="tip">↑ µW → ↑ density &amp; radicals → ↑ etch rate. At fixed bias power, more ion current means a lower V<sub>dc</sub>.</p>`,
    },
    waveguide: {
        t: 'Waveguide, tuner & reflected power',
        h: `<p>Rectangular TE₁₀ waveguide with an auto-tuner, converted to a circular mode above the window.</p>
<p>The tool monitors <b>reflected power</b>. It is high for ~1 s at ignition while the tuner finds the match, then should settle to a few %. Persistently high reflected power means a stuck tuner, arcing, or a coated quartz window.</p>`,
    },
    quartz: {
        t: 'Quartz window',
        h: `<p>The vacuum boundary, transparent to microwaves. Etch by-products (e.g. SiBrₓOᵧ in poly etch) deposit on it, changing coupling and shedding particles.</p>
<p>Chambers are therefore <b>seasoned</b> after wet cleans and cleaned periodically.</p>`,
    },
    shower: {
        t: 'Quartz shower plate',
        h: `<p>Process gas enters a thin <b>plenum</b> between the quartz microwave window and a perforated <b>quartz shower plate</b>, then flows down through many small holes into the discharge.</p><ul>
<li>Spreads gas evenly over the wafer, so radical supply is uniform from centre to edge.</li>
<li>Quartz is transparent to 2.45 GHz and metal-free, so it causes no contamination.</li>
<li>Shields the window from direct plasma contact and deposits.</li></ul>
<p class="tip">Hole erosion or clogging shows up as a slow etch-rate or uniformity drift. The plate is a consumable, cleaned or replaced at preventive maintenance.</p>`,
    },
    coils: {
        t: 'Solenoid coils',
        h: `<p>Three independently powered solenoids (<b>upper, middle, lower</b>) add up to the axial field B(z). Each has its own job:</p><ul>
<li><b>Upper</b> sets B at the quartz window. Keeping B(0) ≥ 875 G gives a <b>high-field launch</b> ("magnetic beach"): the wave travels down a decreasing field into resonance and is absorbed efficiently. Below that, the launch is low-field and density drops.</li>
<li><b>Middle</b> mainly <b>positions the 875 G surface</b>. More current pushes the zone toward the wafer.</li>
<li><b>Lower</b> shapes the field <b>at the wafer</b>. More current gives a less divergent field: higher density but a centre-peaked profile. Less current gives a divergent field and lower density. Too much pulls the zone down onto the wafer.</li></ul>
<p>Upper + middle near zero means no resonance in the chamber, so <b>no plasma</b>.</p>`,
    },
    ecr: {
        t: 'Electron cyclotron resonance',
        h: `<p>Electrons gyrate around B at the cyclotron frequency:</p>
<span class="formula">f<sub>ce</sub> = eB / (2π mₑ) ≈ 2.80 MHz/G × B
2.45 GHz ⇒ B<sub>ECR</sub> = 875 G</span>
<p>Electrons that rotate in step with the right-hand circularly polarised microwave field <b>gain energy on every turn</b>. Ionisation stays efficient even at <b>0.1–1 Pa</b>, where collisions are rare.</p>
<p>The result is a high density (10¹¹–10¹² cm⁻³) at low pressure: long mean free path, directional ions and less microloading.</p>`,
    },
    bfield: {
        t: 'Magnetic field profile B(z)',
        h: `<p>The left graph is |B| along the chamber axis, aligned with the chamber drawing. The amber line marks <b>875 G</b>, and the crossing point is the ECR zone.</p>
<p>The faint curves are the upper, middle and lower coil contributions; the bright curve is their sum.</p>
<p>The cyan field lines follow flux conservation (r ∝ 1/√B). Charged particles follow them, so the <b>expansion ratio</b> B(zone)/B(wafer) shapes the radial plasma profile. About 3–5× gives the best uniformity here.</p>`,
    },
    plasma: {
        t: 'Plasma & ion density',
        h: `<p>Density at the wafer depends on µW power, pressure and how far the plasma must <b>diffuse</b> from the ECR zone.</p>
<ul><li>Higher pressure gives more radicals, but ECR heating weakens above ~1 Pa as collisions interrupt the gyration.</li>
<li>Very low pressure gives poor ignition and few radicals.</li></ul>`,
    },
    ions: {
        t: 'Ions & ion-enhanced etching',
        h: `<p>Ions (red) drift out of the plasma and are <b>accelerated vertically through the sheath</b>. Neutral radicals (dim) move randomly.</p>
<p>Ion bombardment and radicals together etch far faster than either alone (<b>ion-enhanced etching</b>). This vertical synergy is why the profile is anisotropic.</p>
<span class="formula">ER ∝ Γ<sub>ion</sub>·Y(E) · θ + k<sub>chem</sub>·Γ<sub>rad</sub>
Y(E) ∝ √E − √E<sub>th</sub></span>`,
    },
    sheath: {
        t: 'Sheath & ion energy',
        h: `<p>A thin space-charge layer forms above the wafer. RF bias creates a negative <b>self-bias V<sub>dc</sub></b>, and ions arrive with energy ≈ e(V<sub>p</sub> + V<sub>dc</sub>).</p>
<span class="formula">P<sub>bias</sub> ≈ V<sub>dc</sub> · I<sub>ion</sub></span>
<p>At fixed bias power, a denser plasma therefore gives a lower V<sub>dc</sub>. The sheath thickens with V<sub>dc</sub> (Child law). At higher pressure, collisions in the sheath spread the ion angles and anisotropy drops.</p>`,
    },
    rf: {
        t: 'RF bias',
        h: `<p>RF is applied to the stage through a matcher and blocking capacitor and sets the <b>ion energy</b>.</p>
<p>Raising bias:</p><ul><li>raises ER and anisotropy</li>
<li><b>lowers selectivity</b>, because the underlayer's sputter/etch threshold is exceeded</li>
<li>increases plasma and charging damage</li></ul>
<p>Over-etch steps therefore use very low bias.</p>`,
    },
    esc: {
        t: 'Electrostatic chuck (ESC)',
        h: `<p>The ESC clamps the wafer electrostatically so He gas can be held behind it. A chiller (20 °C here) controls the stage temperature.</p>
<p>The <b>dechuck</b> step discharges residual charge before the lift pins raise the wafer. Skipping it causes wafer sticking, popping or mis-transfer.</p>`,
    },
    he: {
        t: 'He backside cooling & wafer temperature',
        h: `<p>He at ~1 kPa fills the micro-gap between wafer and ESC and provides thermal conductance. With low He, the wafer heats under plasma, which causes:</p>
<ul><li>faster <b>lateral chemical etch</b> (bowing, CD loss)</li><li>worse uniformity</li><li>resist reticulation</li></ul>
<p>High He <i>flow</i> at a constant pressure setpoint means a <b>leak</b>: the wafer is not clamped properly.</p>`,
    },
    wafer: {
        t: 'Wafer & film stack',
        h: `<p>The coloured layer on the wafer is the film being etched. Its thickness shrinks during main etch.</p>
<p>After the film clears, the <b>underlayer</b> is exposed and loses thickness at ER/selectivity. For gate etch the oxide is only ~2 nm, so over-etch must be highly selective.</p>`,
    },
    gas: {
        t: 'Gas box & MFCs',
        h: `<p>Mass flow controllers deliver setpoints in sccm. The mixed gas is fed into the plenum above the <a href="#" data-topic="shower">quartz shower plate</a> and enters the plasma through its holes. Chemistry roles:</p><ul>
<li><b>Cl₂</b>: main Si/Al etchant</li>
<li><b>HBr</b>: higher selectivity to oxide, sidewall passivation</li>
<li><b>O₂</b> (a few sccm): oxidises the underlayer surface, so selectivity rises sharply</li>
<li><b>CF₄</b>: breakthrough of native oxide / oxide etch</li>
<li><b>CHF₃</b>: polymer forming, giving selectivity to Si</li>
<li><b>Ar</b>: extra ion bombardment</li>
<li><b>BCl₃</b>: removes Al₂O₃ and scavenges O/H₂O</li></ul>`,
    },
    pump: {
        t: 'Turbo pump & APC valve',
        h: `<p>A turbo-molecular pump with an <b>adaptive pressure control</b> valve. At fixed gas flow, the valve angle sets the pressure.</p>
<span class="formula">residence time τ = p·V / Q</span>
<p>Low pressure (0.1–1 Pa) is what gives ECR its long mean free path and directional ions.</p>`,
    },
    pressure: {
        t: 'Process pressure',
        h: `<p>Raising pressure gives more collisions and more radicals, but weaker ECR coupling, more ion scattering (less anisotropy) and usually worse uniformity.</p>
<p>Lowering pressure improves directionality but lowers radical supply. Very low pressure risks ignition failure.</p>`,
    },
    oes: {
        t: 'Optical emission spectroscopy (OES) endpoint',
        h: `<p>A fibre views the plasma through a window, and a spectrometer tracks an emission line of an <b>etch product</b> (SiCl 405 nm, Al 396 nm, CO 483 nm). When the film clears, product emission <b>drops</b>.</p>
<p>Algorithm used here:</p><ul>
<li>reference = mean intensity over 2–5 s of main etch</li>
<li>the smoothed signal falling below ref × (1 − drop) is the <b>endpoint</b></li>
<li>no endpoint before the max time raises <b>EPD timeout</b></li></ul>
<p>Non-uniformity makes the drop gradual, because different regions clear at different times. A clouded window lowers signal-to-noise.</p>`,
    },
    step_base: { t: 'Step: base pressure check', h: '<p>After the gate valve closes, the chamber is pumped to base pressure (&lt;10⁻³ Pa). This verifies vacuum integrity before process gas is introduced.</p>' },
    step_stab: { t: 'Step: gas stabilize', h: '<p>MFCs ramp to setpoint, the APC throttles to target pressure, the ESC clamps the wafer and He backside is applied. No plasma yet. Flow and pressure are checked against tolerance.</p>' },
    step_ignite: { t: 'Step: plasma ignite & tune', h: '<p>µW on. If the 875 G surface is inside the chamber, the ECR discharge strikes. Reflected power is high for a moment and then falls as the auto-tuner matches.</p><p>No emission at the end of this step gives an <b>ignition failure</b> alarm.</p>' },
    step_bt: { t: 'Step: breakthrough', h: '<p>A short, energetic step that removes native oxide or a hard surface crust (CF₄ for Si, BCl₃ for Al₂O₃). Without it, patchy native oxide micro-masks the film, leaving residue ("grass").</p>' },
    step_me: { t: 'Step: main etch (endpoint)', h: '<p>Bulk film removal with anisotropic, ion-enhanced chemistry. The step ends on the <b>OES endpoint</b> rather than on time, which absorbs incoming thickness and etch-rate variation.</p>' },
    step_oe: { t: 'Step: over-etch', h: '<p>Timed as a <b>% of the main-etch time</b>. Low bias, higher pressure and more O₂ maximise selectivity, so residues and stringers clear while the thin underlayer survives.</p><p>Watch the <b>underlayer loss</b> readout in the chamber view.</p>' },
    step_purge: { t: 'Step: plasma off & purge', h: '<p>µW and RF off, process gas evacuated. This is essential with Cl/Br chemistry: residual halogens cause <b>Al corrosion</b> and attack the transfer chamber.</p>' },
    step_dechuck: { t: 'Step: dechuck & lift', h: '<p>ESC voltage is reversed or discharged and He is turned off. Lift pins raise the wafer for the vacuum robot to pick.</p>' },
    step_tp: { t: 'Step: timed plasma step', h: '<p>A fixed-time plasma step that is not the main etch, e.g. an O₂ <b>ash</b> to strip fluorocarbon polymer, or a low-power Ar <b>plasma dechuck</b> that bleeds residual charge off the ESC. The simulator runs its gases, power, pressure and coils, but it does not remove the main film.</p>' },
    m_er: { t: 'Etch rate', h: '<p>Ion-enhanced model: ER ∝ ion flux × yield(E) × surface coverage, plus spontaneous chemical etch.</p><p>When the <b>radical supply limits</b>, extra bias barely helps. Raise µW or reactive-gas flow instead.</p>' },
    m_sel: { t: 'Selectivity', h: '<p>Selectivity = ER(film) / ER(underlayer). The underlayer has a higher ion-energy threshold, so selectivity rises steeply as bias drops. Passivating additives (O₂, CHF₃, HBr) raise it further.</p>' },
    m_anis: { t: 'Anisotropy & profile angle', h: '<p>Anisotropy = 1 − lateral/vertical etch rate. Lateral etch comes from spontaneous chemical etch, which increases with wafer temperature and is reduced by sidewall passivation, and from ion scattering at higher pressure.</p>' },
    m_uni: { t: 'Etch-rate uniformity', h: '<p>Mostly set by where the ECR zone sits relative to the wafer (field divergence), by pressure (diffusion profile) and by He backside cooling. The best uniformity here is with the zone roughly mid-way.</p>' },
    m_time: { t: 'Estimated main-etch time', h: '<p>Thickness ÷ etch rate. If this exceeds the EPD max time, expect an <b>endpoint timeout</b> alarm.</p>' },
    tour_run: { t: 'Run a wafer', h: '<p>A single wafer has been sent to <b>PM1</b> at 5× speed. Follow it from the load port through the load lock and TM1 into the chamber.</p><p>The <b>recipe sequence</b> table highlights the active step, and the chamber view shows gas, ignition, plasma and ions in real time.</p>' },
    tour_knobs: { t: 'Recipe knobs & trade-offs', h: '<p>The knobs edit the <b>main-etch step</b> of the selected recipe; coil and He apply to all steps. Predicted results update instantly. Things to try:</p><ul><li>Bias → 0: anisotropy falls, selectivity soars</li><li>Upper + middle coils → 0: no resonance, so no plasma</li><li>Lower coil up/down: watch field expansion and uniformity</li><li>He → 0: wafer overheats</li><li>Pressure → 2 Pa: ER changes, anisotropy and uniformity worsen</li></ul>' },
    tour_faults: { t: 'Faults & recovery', h: '<p>Pick a fault and a target, then click <b>Inject</b>. The fault arms and triggers at the realistic point in the sequence.</p><p>Each alarm card shows the code, cause and recommended action. <b>Recover</b> clears the alarm; any wafer in an aborted PM is flagged and returned to its FOUP.</p>' },
    tour_end: { t: 'Tour complete', h: '<p>That covers the platform, the ECR source physics, the recipe sequence, endpoint detection and faults.</p><p>Next: load a full lot, switch recipes, and see how fast you can find the knob combination that maximises selectivity while keeping anisotropy above 0.95.</p>' },
    csv_format: {
        t: 'Recipe CSV format',
        h: `<p>Click <b>Load CSV…</b> to add a recipe, or <b>Export CSV</b> to save the selected one (including knob edits) as a starting point. The file is read locally and never leaves this PC.</p>
<p><b>1. Settings rows</b> (name in column A, value in B; all optional):</p>
<span class="formula">Recipe, My poly etch
Template, poly | al | ox
Film, Poly-Si, 150          (name, nm)
Underlayer, Gate SiO2, 2    (name, nm)
Nominal ER (nm/min), 280
Nominal selectivity, 90
Coil upper (A), 20   (0–27)
Coil middle (A), 18
Coil lower (A), 8
He backside (Pa), 1000
EPD species, SiCl
EPD wavelength (nm), 405
EPD drop (%), 35
EPD max time (s), 120</span>
<p><b>2. Step table</b>, starting with a header row whose first cell is <b>Step</b>:</p>
<span class="formula">Step, Name, Type, Time (s), Over-etch (%), uW (W), Bias (W), Pressure (Pa), Cl2, HBr, O2, …</span>
<ul><li><b>Type</b>: BASE, STAB, IGNITE, BT, ME, OE, PLASMA, PURGE, DECHUCK. Exactly one ME is required.</li>
<li>ME with no Time ends on endpoint. With a Time it always runs that long and EPD only monitors. OE uses <b>Over-etch (%)</b> of the ME time. PLASMA is a timed plasma step (ash, plasma dechuck).</li>
<li>BT, ME, OE and PLASMA need µW, bias, pressure and at least one gas flow (sccm). Optional Coil U/M/L (A) columns set coils per step.</li>
<li>Gas columns: ${Object.keys(GASES).join(', ')}.</li>
<li><b>Template</b> (poly, al, ox, sin) provides the material constants (etch thresholds, plasma colour). If omitted it is guessed from the main-etch gases.</li>
<li>Nominal ER and selectivity are the results you expect at the file's main-etch settings. The model is calibrated to them.</li>
<li>The tool's own export (<i>No, Item, Unit, step…</i>) can also be loaded directly. See the README.</li></ul>`,
    },
};

const KNOB_HINTS = {
    mw: '↑ µW → ↑ ion density & radicals → ↑ ER. At fixed bias power V<sub>dc</sub> falls as ion current rises.',
    bias: '↑ Bias → ↑ ion energy → ↑ ER & anisotropy, but ↓ selectivity (underlayer threshold exceeded).',
    p: '↑ Pressure → more radicals but weaker ECR coupling and more scattering → ↓ anisotropy & uniformity.',
    coilU: 'Upper coil sets B at the window. Keep B(0) ≥ 875 G for an efficient high-field launch; below that, density drops.',
    coilM: 'Middle coil mainly positions the 875 G surface. ↑ current pushes the ECR zone toward the wafer.',
    coilL: 'Lower coil shapes the field at the wafer: ↑ → collimated, denser, centre-peaked; ↓ → divergent, thinner. Too high drags the zone onto the wafer.',
    he: '↓ He backside → hotter wafer → more lateral chemical etch, worse uniformity; >130 °C alarms.',
    gas: 'Reactive gas ↑ → more radicals. Passivating gases (O₂, CHF₃, HBr) ↑ → selectivity & anisotropy ↑.',
};

/* =====================================================================
   5. Simulation state & tool model
   ===================================================================== */
const SIM = {
    t: 0, running: true, speed: 5, selPM: 1, recipeKey: 'poly', follow: true, tour: -1,
    wafers: [], queue: [], lots: 0, wafersOut: 0, firstStart: null,
    alarms: [], alarmSeq: 0, pairNext: [1, 3, 5],
};

const PAIRS = [[1, 2], [3, 4], [5, 6]];
const pairName = p => `PM${PAIRS[p][0]}&${PAIRS[p][1]}`;

const STEP_SHORT = { base: 'Base', stab: 'Stab', ignite: 'Ign', bt: 'BT', me: 'ME', oe: 'OE', purge: 'Purge', dechuck: 'Dechk' };
const stepShort = st => st.type === 'tp' ? st.name.slice(0, 6) : STEP_SHORT[st.type];

const GEO = {
    lpX: 48, lpY: i => 190 + (i - 3) * 62,
    efem: { x: 136, y: 190 },
    ll: { 'LL-A': { x: 225, y: 150 }, 'LL-B': { x: 225, y: 230 } },
    tm: { TM1: { x: 345, y: 190 }, TM2: { x: 565, y: 190 }, TM3: { x: 785, y: 190 } },
    buf: { 'BUF12-in': { x: 455, y: 174 }, 'BUF12-out': { x: 455, y: 206 }, 'BUF23-in': { x: 675, y: 174 }, 'BUF23-out': { x: 675, y: 206 } },
    pm: { 1: { x: 345, y: 64 }, 2: { x: 345, y: 316 }, 3: { x: 565, y: 64 }, 4: { x: 565, y: 316 }, 5: { x: 785, y: 64 }, 6: { x: 785, y: 316 } },
};

const ROUTES = {
    TM1: { pms: [1, 2], inFrom: ['LL-A', 'LL-B'], inNext: 'BUF12-in', outTo: ['LL-A', 'LL-B'], outFrom: ['BUF12-out'] },
    TM2: { pms: [3, 4], inFrom: ['BUF12-in'], inNext: 'BUF23-in', outTo: ['BUF12-out'], outFrom: ['BUF23-out'] },
    TM3: { pms: [5, 6], inFrom: ['BUF23-in'], inNext: null, outTo: ['BUF23-out'], outFrom: [] },
};

let stations = {}, pms = {}, robots = {}, LP = [];

function makeStation(name, kind, x, y, extra = {}) {
    const s = { name, kind, x, y, wafer: null, reserved: false, ...extra };
    stations[name] = s;
    return s;
}

function initTool() {
    stations = {}; pms = {}; robots = {}; LP = [];
    for (let i = 1; i <= 5; i++) LP[i] = { id: i, x: GEO.lpX, y: GEO.lpY(i), slots: new Array(25).fill(null) };
    for (const n in GEO.ll) makeStation(n, 'll', GEO.ll[n].x, GEO.ll[n].y, { mode: 'atm', press: P_ATM, t: 0, fault: false, alarm: null });
    for (const n in GEO.buf) makeStation(n, 'buf', GEO.buf[n].x, GEO.buf[n].y);
    for (let i = 1; i <= 6; i++) {
        pms[i] = makeStation('PM' + i, 'pm', GEO.pm[i].x, GEO.pm[i].y, {
            id: i, state: 'idle', assigned: null, alarm: null, armed: new Set(), recipeKey: null,
            stepIdx: -1, stepT: 0, procT: 0, removed: 0, cleared: 0, underLoss: 0, meTime: 0,
            oes: [], marks: [], oesAcc: 0, lastOES: 0, epd: null, tW: 20, refl: 0, pressure: 5e-4,
            live: { plasma: false }, gasAct: null, lastResult: null,
        });
    }
    const mkRobot = (name, x, y, track) => {
        robots[name] = { name, kind: 'robot', hub: { x, y }, hub0: { x, y }, track, angle: track ? 0 : -Math.PI / 2, move: null, alarm: null, armed: false };
    };
    mkRobot('EFEM', GEO.efem.x, GEO.efem.y, true);
    for (const n in GEO.tm) mkRobot(n, GEO.tm[n].x, GEO.tm[n].y, false);
}

const isOut = w => w.processed || w.aborted;
const LLS = () => [stations['LL-A'], stations['LL-B']];
const inVac = w => !!w.loc && (w.loc.startsWith('PM') || w.loc.startsWith('BUF') || w.loc.startsWith('robot:TM'));
const vacCount = () => SIM.wafers.filter(inVac).length;
const outboundPending = () => SIM.wafers.filter(w => inVac(w) && isOut(w)).length;
const vacEmptyLLs = () => LLS().filter(l => l.mode === 'vac' && !l.wafer && !l.reserved).length;
const pmFree = pm => !pm.assigned && pm.state === 'idle' && !pm.alarm && !pm.wafer && !pm.reserved;

function choosePM(w) {
    if (w.forcePM) return pmFree(pms[w.forcePM]) ? pms[w.forcePM] : null;
    const [a, b] = PAIRS[w.pair];
    const first = SIM.pairNext[w.pair] === b ? b : a;
    for (const id of [first, first === a ? b : a]) if (pmFree(pms[id])) return pms[id];
    return null;
}

// Lots on different pairs must not block each other, so scan past wafers whose pair is busy
function nextDispatchable() {
    for (let i = 0; i < SIM.queue.length; i++) {
        const pm = choosePM(SIM.queue[i]);
        if (pm) return { i, w: SIM.queue[i], pm };
    }
    return null;
}
const canDispatch = () => !!nextDispatchable();

function canPick(s, side) {
    if (!s.wafer || s.reserved) return false;
    if (s.kind === 'pm') return s.state === 'done';
    if (s.kind === 'll') return !s.alarm && s.mode === side;
    return true;
}

function canPlace(s, w, side) {
    if (s.wafer || s.reserved) return false;
    if (s.kind === 'pm') return s.state === 'idle' && s.assigned === w && !s.alarm;
    if (s.kind === 'll') return !s.alarm && s.mode === side;
    return true;
}

/* ---------- Robots ---------- */
function tmCandidate(r) {
    const R = ROUTES[r.name];
    const outSources = [...R.pms.map(i => pms[i]), ...R.outFrom.map(n => stations[n])];
    for (const s of outSources) {
        if (!canPick(s, 'vac') || !isOut(s.wafer)) continue;
        for (const d of R.outTo) if (canPlace(stations[d], s.wafer, 'vac')) return { from: s, to: stations[d] };
    }
    for (const n of R.inFrom) {
        const s = stations[n];
        if (!canPick(s, 'vac') || isOut(s.wafer)) continue;
        const w = s.wafer;
        const dest = R.pms.includes(w.pm) ? pms[w.pm] : (R.inNext ? stations[R.inNext] : null);
        if (dest && canPlace(dest, w, 'vac')) return { from: s, to: dest };
    }
    return null;
}

function efemCandidate() {
    for (const ll of LLS()) {
        if (canPick(ll, 'atm') && isOut(ll.wafer)) {
            const w = ll.wafer, lp = LP[w.lp];
            return { from: ll, to: { name: 'LP' + w.lp, kind: 'lp', x: lp.x, y: lp.y, wafer: null, reserved: false } };
        }
    }
    const d = nextDispatchable();
    if (!d) return null;
    const { w, pm } = d;
    for (const ll of LLS()) {
        if (!canPlace(ll, w, 'atm')) continue;
        SIM.queue.splice(d.i, 1);
        w.pm = pm.id;
        pm.assigned = w;
        if (!w.forcePM) SIM.pairNext[w.pair] = PAIRS[w.pair].find(id => id !== pm.id);
        const lp = LP[w.lp];
        return { from: { name: 'LP' + w.lp, kind: 'lp', x: lp.x, y: lp.y, wafer: w, reserved: false }, to: ll };
    }
    return null;
}

function robotTarget(r, st) {
    const hub = r.track ? { x: r.hub0.x, y: clamp(st.y, 50, 330) } : r.hub0;
    return { hub, ang: Math.atan2(st.y - hub.y, st.x - hub.x), len: Math.hypot(st.x - hub.x, st.y - hub.y) };
}

function robotTick(r, dt) {
    if (r.alarm) return;
    if (!r.move) {
        const c = r.name === 'EFEM' ? efemCandidate() : tmCandidate(r);
        if (!c) return;
        c.from.reserved = true;
        c.to.reserved = true;
        r.move = { from: c.from, to: c.to, w: c.from.wafer, t: 0, dur: r.track ? 3.5 : 3, picked: false, placed: false, hubA: { ...r.hub }, angA: r.angle };
        return;
    }
    const m = r.move;
    m.t += dt;
    const ph = m.t / m.dur;
    if (!m.picked && ph >= 0.35) {
        m.picked = true;
        m.w = m.from.wafer;
        m.from.wafer = null;
        m.from.reserved = false;
        onPick(m.from, m.w, r);
        if (r.armed) {
            r.armed = false;
            r.alarm = raiseAlarm('ROBOT_ERR', r, `${r.name}: ${m.w.label} not detected on end-effector after pick from ${m.from.name}`);
            return;
        }
    }
    if (m.picked && !m.placed && ph >= 0.85) {
        m.placed = true;
        m.to.wafer = m.w;
        m.to.reserved = false;
        onPlace(m.to, m.w);
    }
    if (ph >= 1) {
        const d = robotTarget(r, m.to);
        r.hub = { ...d.hub };
        r.angle = d.ang;
        r.move = null;
    }
}

function onPick(src, w, r) {
    w.loc = 'robot:' + r.name;
    if (src.kind === 'lp') w.state = 'transit';
    if (src.kind === 'pm') {
        src.state = 'idle';
        src.assigned = null;
        src.wafer = null;
        src.live = { plasma: false };
    }
}

function onPlace(dst, w) {
    w.loc = dst.name;
    if (dst.kind === 'pm') pmStart(dst, w);
    if (dst.kind === 'lp') {
        dst.wafer = null;
        w.state = 'returned';
        w.loc = 'LP';
        SIM.wafersOut++;
        log(`${w.label} returned to LP${w.lp} slot ${w.slot}${w.aborted ? ' (ABORTED)' : ''}`, w.aborted ? 'warn' : '');
    }
}

/* ---------- Load locks ---------- */
function llTick(ll, dt) {
    switch (ll.mode) {
        case 'pumping':
            ll.t += dt;
            ll.press = ll.fault ? Math.max(1800, ll.press * Math.exp(-dt / 0.8)) : ll.press * Math.exp(-dt / 0.8);
            if (ll.fault && ll.t > 20 && !ll.alarm) ll.alarm = raiseAlarm('LL_PUMP', ll, `${ll.name} at ${fmtPa(ll.press)} after ${ll.t.toFixed(0)} s (limit 20 s)`);
            if (!ll.fault && ll.press <= P_LL_VAC) { ll.press = P_LL_VAC; ll.mode = 'vac'; }
            break;
        case 'venting':
            ll.t += dt;
            ll.press = Math.exp(lerp(Math.log(P_LL_VAC), Math.log(P_ATM), clamp(ll.t / 5, 0, 1)));
            if (ll.t >= 5) { ll.mode = 'atm'; ll.press = P_ATM; }
            break;
        case 'atm':
            if (ll.reserved || ll.alarm) break;
            if (ll.wafer ? !isOut(ll.wafer) : (!canDispatch() && vacCount() > 0)) { ll.mode = 'pumping'; ll.t = 0; }
            break;
        case 'vac':
            if (ll.reserved) break;
            if (ll.wafer ? isOut(ll.wafer) : (canDispatch() && (outboundPending() === 0 || vacEmptyLLs() > 1))) { ll.mode = 'venting'; ll.t = 0; }
            break;
    }
}

/* ---------- Process module sequencer ---------- */
function nextPlasmaStep(r, idx) {
    for (let i = idx; i < r.steps.length; i++) if (PLASMA_STEPS.includes(r.steps[i].type)) return r.steps[i];
    return null;
}
const oeDur = (pm, st) => Math.max(3, pm.meTime * st.overPct / 100);

function pmStart(pm, w) {
    const r = RECIPES[w.recipe];
    Object.assign(pm, {
        state: 'processing', recipeKey: w.recipe, stepIdx: -1, stepT: 0, procT: 0, removed: 0, cleared: 0,
        underLoss: 0, meTime: 0, oes: [], marks: [], oesAcc: 0, lastOES: 0, epd: null, tW: 22, refl: 0,
    });
    w.state = 'processing';
    log(`${w.label} → ${pm.name}: start "${r.name}"`);
    pmNext(pm);
}

function pmNext(pm) {
    const r = RECIPES[pm.recipeKey];
    pm.stepIdx++;
    pm.stepT = 0;
    if (pm.stepIdx >= r.steps.length) return pmFinish(pm);
    const st = r.steps[pm.stepIdx];
    pm.marks.push({ t: pm.procT, name: stepShort(st) });
    if (st.type === 'me') pm.epd = { acc: 0, n: 0, ref: null, thr: null, refT: null, ema: null, hit: false, hitT: null };
    if (SIM.follow && SIM.tour < 0 && SIM.selPM === pm.id) showTopic('step_' + st.type);
}

function pmFinish(pm) {
    const r = RECIPES[pm.recipeKey], w = pm.wafer;
    pm.state = 'done';
    pm.live = { plasma: false };
    w.processed = true;
    w.state = 'transit';
    w.result = { me: pm.meTime, under: pm.underLoss, ep: !!(pm.epd && pm.epd.hit), pre: r.film.thick, post: Math.max(0, r.film.thick - pm.removed) };
    pm.lastResult = { label: w.label, recipe: r.name, ...w.result, filmName: r.film.name, underName: r.under.name, underThick: r.under.thick };
    const punch = pm.underLoss > r.under.thick;
    const film = `${r.film.name} ${w.result.pre.toFixed(1)} → ${w.result.post.toFixed(1)} nm`;
    log(`${w.label} ${pm.name} done: ${film}, ME ${pm.meTime.toFixed(1)} s, ${r.under.name} loss ${pm.underLoss.toFixed(2)} nm${punch ? ' — PUNCH-THROUGH!' : ''}`, punch ? 'warn' : 'ok');
}

function pmAlarm(pm, key, detail) {
    pm.state = 'alarm';
    pm.live = { plasma: false };
    pm.alarm = raiseAlarm(key, pm, `${pm.name}${pm.wafer ? ' / ' + pm.wafer.label : ''}: ${detail}`);
}

function oesValue(pm, r, st, model, plasma) {
    let v = 1.5;
    if (plasma && model) {
        const dens = model.nW / 0.55;
        let prod = 0;
        if (st.type === 'me' || st.type === 'oe') prod = 80 * dens * Math.min(2, model.er / r.nominal.er) * (1 - pm.cleared);
        else if (st.type === 'bt') prod = 30 * dens;
        else if (st.type === 'ignite') prod = 10 * dens;
        v = 14 * dens + prod;
    }
    // a clouded window leaves a weak line on top of stray background light
    if (pm.armed.has('EPD_TIMEOUT')) v = v * 0.15 + 55;
    return Math.max(0, v + (Math.random() - 0.5) * 2.4);
}

function pmTick(pm, dt) {
    const relax = (tTarget, pTarget) => {
        pm.tW += (tTarget - pm.tW) * (1 - Math.exp(-dt / 3));
        const lp = Math.log(pm.pressure);
        pm.pressure = Math.exp(lp + (Math.log(pTarget) - lp) * (1 - Math.exp(-dt / 0.7)));
    };
    if (pm.state !== 'processing') {
        relax(20, 5e-4);
        pm.refl = 0;
        return;
    }

    const r = RECIPES[pm.recipeKey], st = r.steps[pm.stepIdx], hw = r.hw;
    const armed = k => pm.armed.has(k);
    pm.stepT += dt;
    pm.procT += dt;
    const heEff = armed('HE_LEAK') ? hw.he * 0.08 : hw.he;
    const isPlasmaStep = PLASMA_STEPS.includes(st.type);

    let sp = null;
    if (st.type === 'stab' || st.type === 'ignite') sp = nextPlasmaStep(r, pm.stepIdx);
    else if (isPlasmaStep) sp = st;

    const tripped = armed('COIL_TRIP') && isPlasmaStep && pm.stepT > 1.5;
    const coils = tripped ? [0, 0, 0] : (sp && sp.coils) || hw.coils;
    let model = null, plasma = false;
    if (sp && (st.type === 'ignite' || isPlasmaStep)) model = plasmaModel(r, sp, coils, heEff);
    if (st.type === 'ignite') plasma = model.ok && !armed('IGN_FAIL') && pm.stepT > 0.4;
    else if (isPlasmaStep) plasma = model.ok;

    pm.gasAct = sp ? { ...sp.gases } : null;
    if (pm.gasAct && armed('MFC_DEV')) {
        const g = Object.keys(pm.gasAct)[0];
        pm.gasAct[g] *= 0.7;
    }

    if (armed('MW_REFL') && (st.type === 'ignite' || isPlasmaStep)) pm.refl = 38 + Math.random() * 4;
    else if (st.type === 'ignite') pm.refl = plasma ? model.refl + 45 * Math.exp(-(pm.stepT - 0.4) / 0.35) : (model.ok ? 60 : 85);
    else if (plasma) pm.refl = model.refl + (Math.random() - 0.5) * 0.6;
    else pm.refl = 0;

    const pTarget = sp ? (armed('PRESS_TOL') ? sp.p * 1.6 : sp.p) : 5e-4;
    relax(plasma ? model.tW : 20, pTarget);
    pm.live = { plasma, gasOn: !!sp && st.type !== 'purge', sp, model, coils };
    const epdRes = sampleOES(pm, r, st, model, plasma, dt);
    const stepDone = pm.stepT >= (st.dur || Infinity);

    let alarm = null;
    switch (st.type) {
        case 'stab':
            if (armed('MFC_DEV') && pm.stepT > 2) {
                const g = Object.keys(sp.gases)[0];
                alarm = ['MFC_DEV', `${g} actual ${pm.gasAct[g].toFixed(0)} sccm vs setpoint ${sp.gases[g]} sccm (−30 %)`];
            } else if (stepDone) {
                if (armed('PRESS_TOL')) alarm = ['PRESS_TOL', `pressure ${pm.pressure.toFixed(2)} Pa vs setpoint ${sp.p} Pa, APC at limit`];
                else return pmNext(pm);
            }
            break;
        case 'ignite':
            if (stepDone) {
                if (!model.ok || armed('IGN_FAIL')) alarm = ['IGN_FAIL', model.ok ? 'no emission detected by OES after µW on' : modelReason(model, sp)];
                else if (pm.refl > 15) alarm = ['MW_REFL', `reflected ${pm.refl.toFixed(0)} % of forward (limit 15 %)`];
                else return pmNext(pm);
            }
            break;
        case 'bt': case 'me': case 'oe': case 'tp':
            if (!model.ok) alarm = tripped ? ['COIL_TRIP', 'coil PSU tripped — B-field collapsed, plasma extinguished'] : ['IGN_FAIL', 'plasma lost: ' + modelReason(model, sp)];
            else if (armed('HE_LEAK') && pm.stepT > 2.5) alarm = ['HE_LEAK', `He flow 9.8 sccm (limit 3 sccm), wafer at ${pm.tW.toFixed(0)} °C`];
            else if (pm.tW > 130) alarm = ['TEMP_HIGH', `wafer temperature ${pm.tW.toFixed(0)} °C (limit 130 °C)`];
            else if (pm.refl > 15 && pm.stepT > 1) alarm = ['MW_REFL', `reflected ${pm.refl.toFixed(0)} % of forward (limit 15 %)`];
            else if (epdRes === 'timeout') alarm = ['EPD_TIMEOUT', `no endpoint after ${r.epd.maxTime} s on ${r.epd.species} ${r.epd.wl} nm`];
            if (alarm) break;
            if (st.type === 'me' || st.type === 'oe') etchProgress(pm, r, model, dt);
            if ((st.type === 'bt' || st.type === 'tp') && stepDone) return pmNext(pm);
            if (st.type === 'oe' && pm.stepT >= oeDur(pm, st)) return pmNext(pm);
            if (epdRes === 'ep') {
                pm.epd.hit = true;
                pm.epd.hitT = pm.procT;
                pm.meTime = pm.stepT;
                log(`${pm.name} endpoint at ${pm.stepT.toFixed(1)} s (${r.epd.species} ${r.epd.wl} nm)${st.dur ? ' — monitor only, step continues' : ''}`);
                if (!st.dur) return pmNext(pm);
            }
            // timed main etch: EPD only monitors, the step runs its full time
            if (st.type === 'me' && stepDone) {
                if (!pm.epd.hit) {
                    pm.meTime = pm.stepT;
                    const left = Math.max(0, r.film.thick - pm.removed);
                    log(`${pm.name} ${st.name}: timed etch ended at ${st.dur} s, ${left.toFixed(1)} nm ${r.film.name} left (film not cleared, no endpoint)`);
                }
                return pmNext(pm);
            }
            break;
        default:
            if (stepDone) return pmNext(pm);
    }
    if (alarm) pmAlarm(pm, alarm[0], alarm[1]);
}

function etchProgress(pm, r, model, dt) {
    const rate = model.er / 60;
    pm.removed += rate * dt;
    const sigma = Math.max(0.5, r.film.thick * model.uni / 100 * 1.5);
    pm.cleared = normCdf((pm.removed - r.film.thick) / sigma);
    pm.underLoss += pm.cleared * rate / model.sel * dt;
}

function sampleOES(pm, r, st, model, plasma, dt) {
    pm.oesAcc += dt;
    if (pm.oesAcc < 0.2) return null;
    pm.oesAcc = 0;
    const v = oesValue(pm, r, st, model, plasma);
    pm.lastOES = v;
    pm.oes.push({ t: pm.procT, v });
    if (pm.oes.length > 3000) pm.oes.shift();
    if (st.type !== 'me' || !plasma) return null;
    const e = pm.epd;
    if (e.hit) return null;
    const d0 = r.epd.deadTime ?? 2;
    if (pm.stepT >= d0 && pm.stepT <= d0 + 3) { e.acc += v; e.n++; }
    else if (pm.stepT > d0 + 3 && e.ref === null && e.n) {
        e.ref = e.acc / e.n;
        e.thr = e.ref * (1 - r.epd.drop);
        e.refT = pm.procT;
    }
    e.ema = e.ema === null ? v : e.ema * 0.7 + v * 0.3;
    if (e.ref !== null && e.ema < e.thr) return 'ep';
    if (!st.dur && pm.stepT >= r.epd.maxTime) return 'timeout';
    return null;
}

/* ---------- Lots ---------- */
// Least-loaded healthy pair; an alarmed chamber makes its pair a last resort
function autoPair() {
    let best = 0, bestScore = Infinity;
    PAIRS.forEach((ids, p) => {
        const score = SIM.wafers.filter(w => w.pair === p && w.state !== 'returned').length
            + 1000 * ids.filter(id => pms[id].alarm).length;
        if (score < bestScore) { best = p; bestScore = score; }
    });
    return best;
}

function loadLot(lpId, n, recipeKey, forcePM = null, pair = null) {
    const lp = LP[lpId];
    if (lp.slots.some(w => w && w.state !== 'returned')) {
        log(`LP${lpId} busy — previous lot still in the tool`, 'warn');
        return false;
    }
    if (forcePM) pair = PAIRS.findIndex(ids => ids.includes(forcePM));
    else if (pair === null) pair = autoPair();
    for (const w of SIM.wafers) if (w.lp === lpId && w.el) w.el.remove();
    SIM.wafers = SIM.wafers.filter(w => w.lp !== lpId);
    SIM.lots++;
    lp.slots = new Array(25).fill(null);
    for (let i = 1; i <= n; i++) {
        const w = {
            label: `L${SIM.lots}-W${String(i).padStart(2, '0')}`, slot: i, lot: SIM.lots, lp: lpId, recipe: recipeKey,
            state: 'atLP', pm: null, forcePM, pair, processed: false, aborted: false, loc: 'LP', result: null,
        };
        w.el = makeWaferToken(w);
        lp.slots[i - 1] = w;
        SIM.wafers.push(w);
        SIM.queue.push(w);
    }
    if (SIM.firstStart === null) SIM.firstStart = SIM.t;
    log(`Lot L${SIM.lots}: ${n} wafer(s), "${RECIPES[recipeKey].name}" on LP${lpId} → ${forcePM ? 'PM' + forcePM : pairName(pair)}`, 'ok');
    return true;
}

function runSingle(pmId) {
    for (let i = 1; i <= 5; i++) {
        if (!LP[i].slots.some(w => w && w.state !== 'returned')) return loadLot(i, 1, SIM.recipeKey, pmId);
    }
    log('All load ports busy', 'warn');
    return false;
}

/* ---------- Alarms ---------- */
function raiseAlarm(key, src, detail) {
    const f = FAULTS[key];
    const a = { id: ++SIM.alarmSeq, key, code: f.code, title: f.title, src, detail, t: SIM.t };
    SIM.alarms.push(a);
    log(`ALARM ${f.code} ${src.name}: ${f.title}`, 'err');
    renderAlarms();
    renderArmed();
    if (SIM.follow && SIM.tour < 0) showFaultTopic(key);
    return a;
}

function recoverAlarm(id) {
    const a = SIM.alarms.find(x => x.id === id);
    if (!a) return;
    SIM.alarms = SIM.alarms.filter(x => x !== a);
    const s = a.src;
    if (s.kind === 'pm') {
        s.alarm = null;
        s.armed.delete(a.key);
        if (s.wafer) {
            s.wafer.aborted = true;
            s.wafer.state = 'transit';
            s.state = 'done';
            log(`${s.wafer.label} aborted in ${s.name} → returning to FOUP`, 'warn');
        } else s.state = 'idle';
    } else if (s.kind === 'll') {
        s.alarm = null;
        s.fault = false;
        s.t = 0;
    } else if (s.kind === 'robot') {
        s.alarm = null;
    }
    log(`${a.code} ${s.name} recovered`, 'ok');
    renderAlarms();
    renderArmed();
}

function simStep(dt) {
    SIM.t += dt;
    for (const ll of LLS()) llTick(ll, dt);
    for (let i = 1; i <= 6; i++) pmTick(pms[i], dt);
    for (const n in robots) robotTick(robots[n], dt);
}

/* ---------- Event log ---------- */
function log(msg, cls = '') {
    const ul = $('#eventLog');
    if (!ul) return;
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = `<span class="t">${fmtClock(SIM.t)}</span>${escapeHtml(msg)}`;
    ul.prepend(li);
    while (ul.children.length > 200) ul.lastChild.remove();
}

/* =====================================================================
   6. Platform view (SVG)
   ===================================================================== */
const PV = { svg: null, wafers: null, lpDots: [], ll: {}, pm: {}, robots: {} };
const WAFER_COLORS = { fresh: '#9fb4d3', processing: '#c48bff', done: '#39d98a', aborted: '#ff4d5e' };

function waferColor(w) {
    if (w.aborted) return WAFER_COLORS.aborted;
    if (w.processed) return WAFER_COLORS.done;
    if (w.state === 'processing') return WAFER_COLORS.processing;
    return WAFER_COLORS.fresh;
}

function octagon(cx, cy, r) {
    const pts = [];
    for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + k * Math.PI / 4;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
}

function buildPlatform() {
    const s = PV.svg = $('#platformSvg');
    s.innerHTML = '';
    const defs = svg('defs', {}, s);
    for (let i = 1; i <= 6; i++) {
        const g = svg('radialGradient', { id: 'gp' + i }, defs);
        svg('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.9 }, g);
        svg('stop', { offset: '35%', 'stop-color': '#b56cff', 'stop-opacity': 0.7 }, g);
        svg('stop', { offset: '100%', 'stop-color': '#b56cff', 'stop-opacity': 0 }, g);
    }

    const bg = svg('g', {}, s);
    // vacuum envelope
    svg('path', { d: 'M196 112 H 830 V 268 H 196 Z', fill: '#0b1a2e', stroke: '#1d3557', 'stroke-dasharray': '4 4', opacity: 0.6 }, bg);
    svg('text', { x: 520, y: 372, class: 'title', 'text-anchor': 'middle' }, bg).textContent = 'VACUUM PLATFORM';

    // EFEM
    const efem = svg('g', { class: 'hot' }, bg);
    svg('rect', { x: 94, y: 26, width: 84, height: 328, rx: 6, class: 'frame' }, efem);
    svg('line', { x1: 136, y1: 44, x2: 136, y2: 336, stroke: '#24344d', 'stroke-width': 8, 'stroke-linecap': 'round' }, efem);
    svg('text', { x: 136, y: 20, class: 'title', 'text-anchor': 'middle' }, efem).textContent = 'EFEM (ATM)';
    efem.addEventListener('click', () => showTopic('efem'));

    // Load ports
    PV.lpDots = [];
    for (let i = 1; i <= 5; i++) {
        const g = svg('g', { class: 'hot' }, bg);
        const y = GEO.lpY(i);
        svg('rect', { x: 12, y: y - 27, width: 72, height: 54, rx: 4, class: 'frame' }, g);
        svg('text', { x: 16, y: y - 17 }, g).textContent = 'LP' + i;
        const dots = [];
        for (let k = 0; k < 25; k++) {
            dots.push(svg('circle', { cx: 32 + (k % 5) * 10, cy: y - 10 + Math.floor(k / 5) * 8.5, r: 3, fill: '#1a2436' }, g));
        }
        PV.lpDots[i] = dots;
        g.addEventListener('click', () => showTopic('lp'));
    }

    // Load locks
    for (const n of ['LL-A', 'LL-B']) {
        const st = stations[n];
        const g = svg('g', { class: 'hot' }, bg);
        svg('rect', { x: st.x - 25, y: st.y - 34, width: 50, height: 68, rx: 4, class: 'vac' }, g);
        const fill = svg('rect', { x: st.x - 23, y: st.y - 32, width: 4, height: 64, fill: '#3fd0ff', opacity: 0.8 }, g);
        svg('text', { x: st.x + 2, y: st.y - 22, 'text-anchor': 'middle', class: 'title' }, g).textContent = n;
        const mode = svg('text', { x: st.x + 2, y: st.y + 22, 'text-anchor': 'middle' }, g);
        const pr = svg('text', { x: st.x + 2, y: st.y + 31, 'text-anchor': 'middle' }, g);
        PV.ll[n] = { fill, mode, pr };
        g.addEventListener('click', () => showTopic('ll'));
    }

    // Transfer modules & gate valves to PMs
    for (const n in GEO.tm) {
        const c = GEO.tm[n];
        const g = svg('g', { class: 'hot' }, bg);
        svg('polygon', { points: octagon(c.x, c.y, 62), class: 'vac' }, g);
        svg('text', { x: c.x, y: c.y + 50, 'text-anchor': 'middle', class: 'title' }, g).textContent = n;
        g.addEventListener('click', () => showTopic('tm'));
        svg('rect', { x: c.x - 14, y: c.y - 70, width: 28, height: 8, fill: '#33435e' }, bg);
        svg('rect', { x: c.x - 14, y: c.y + 62, width: 28, height: 8, fill: '#33435e' }, bg);
    }

    // Buffers
    for (const pair of [['BUF12-in', 'BUF12-out', 455], ['BUF23-in', 'BUF23-out', 675]]) {
        const g = svg('g', { class: 'hot' }, bg);
        svg('rect', { x: pair[2] - 22, y: 158, width: 44, height: 64, rx: 4, class: 'vac' }, g);
        svg('text', { x: pair[2], y: 152, 'text-anchor': 'middle' }, g).textContent = 'BUF';
        svg('text', { x: pair[2] + 26, y: 177 }, g).textContent = '→';
        svg('text', { x: pair[2] + 26, y: 209 }, g).textContent = '←';
        g.addEventListener('click', () => showTopic('buf'));
    }

    // Process modules
    for (let i = 1; i <= 6; i++) {
        const pm = pms[i];
        const g = svg('g', { class: 'hot' }, bg);
        svg('circle', { cx: pm.x, cy: pm.y, r: 48, class: 'frame' }, g);
        const glow = svg('circle', { cx: pm.x, cy: pm.y, r: 40, fill: `url(#gp${i})`, opacity: 0 }, g);
        const ring = svg('circle', { cx: pm.x, cy: pm.y, r: 46, class: 'pm-ring idle' }, g);
        const sel = svg('circle', { cx: pm.x, cy: pm.y, r: 55, class: 'pm-sel', opacity: 0 }, g);
        const up = i % 2 === 1;
        svg('text', { x: pm.x, y: pm.y + (up ? -30 : 38), 'text-anchor': 'middle', class: 'title' }, g).textContent = 'PM' + i + ' · ECR';
        const status = svg('text', { x: pm.x, y: pm.y + (up ? 30 : -27), 'text-anchor': 'middle' }, g);
        g.addEventListener('click', () => selectPM(i));
        PV.pm[i] = { glow, ring, sel, status, grad: s.querySelector(`#gp${i}`) };
    }

    // Robots
    const rg = svg('g', {}, s);
    for (const n in robots) {
        const arm = svg('line', { class: 'arm' }, rg);
        const eff = svg('rect', { width: 14, height: 8, rx: 2, fill: '#8fa6c8' }, rg);
        const hub = svg('circle', { r: n === 'EFEM' ? 10 : 13, class: 'hub' }, rg);
        PV.robots[n] = { arm, eff, hub };
    }

    PV.wafers = svg('g', {}, s);
    for (const w of SIM.wafers) {
        w.el = makeWaferToken(w);
    }
}

function makeWaferToken(w) {
    const g = svg('g', { visibility: 'hidden' }, PV.wafers);
    svg('circle', { r: 11, class: 'wafer' }, g);
    svg('text', { class: 'wafer-label' }, g).textContent = w.slot;
    return g;
}

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
}
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function robotPose(r) {
    const m = r.move;
    if (!m) return { hub: r.hub, ang: r.angle, len: 16, carry: null };
    const ph = clamp(m.t / m.dur, 0, 1);
    const A = { hub: m.hubA, ang: m.angA }, S = robotTarget(r, m.from), D = robotTarget(r, m.to);
    const seg = (a, b, t) => ({ hub: { x: lerp(a.hub.x, b.hub.x, t), y: lerp(a.hub.y, b.hub.y, t) }, ang: lerpAngle(a.ang, b.ang, t) });
    let pose, len;
    if (ph < 0.15) { pose = seg(A, S, ease(ph / 0.15)); len = 16; }
    else if (ph < 0.35) { pose = S; len = lerp(16, S.len, ease((ph - 0.15) / 0.2)); }
    else if (ph < 0.5) { pose = S; len = lerp(S.len, 16, ease((ph - 0.35) / 0.15)); }
    else if (ph < 0.65) { pose = seg(S, D, ease((ph - 0.5) / 0.15)); len = 16; }
    else if (ph < 0.85) { pose = D; len = lerp(16, D.len, ease((ph - 0.65) / 0.2)); }
    else { pose = D; len = lerp(D.len, 16, ease((ph - 0.85) / 0.15)); }
    return { hub: pose.hub, ang: pose.ang, len, carry: m.picked && !m.placed ? m.w : null };
}

function renderPlatform() {
    const poses = {};
    for (const n in robots) {
        const r = robots[n], p = robotPose(r), v = PV.robots[n];
        poses[n] = p;
        const ex = p.hub.x + Math.cos(p.ang) * p.len, ey = p.hub.y + Math.sin(p.ang) * p.len;
        v.arm.setAttribute('x1', p.hub.x); v.arm.setAttribute('y1', p.hub.y);
        v.arm.setAttribute('x2', ex); v.arm.setAttribute('y2', ey);
        v.eff.setAttribute('x', ex - 7); v.eff.setAttribute('y', ey - 4);
        v.eff.setAttribute('transform', `rotate(${p.ang * 180 / Math.PI} ${ex} ${ey})`);
        v.hub.setAttribute('cx', p.hub.x); v.hub.setAttribute('cy', p.hub.y);
        v.hub.setAttribute('class', 'hub' + (r.alarm ? ' alarm' : ''));
    }

    for (const w of SIM.wafers) {
        if (!w.el) continue;
        let x = null, y = null;
        if (w.loc && w.loc.startsWith('robot:')) {
            const p = poses[w.loc.slice(6)];
            x = p.hub.x + Math.cos(p.ang) * p.len;
            y = p.hub.y + Math.sin(p.ang) * p.len;
        } else if (w.loc && stations[w.loc]) {
            x = stations[w.loc].x;
            y = stations[w.loc].y;
        }
        if (x === null) { w.el.setAttribute('visibility', 'hidden'); continue; }
        w.el.setAttribute('visibility', 'visible');
        w.el.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
        w.el.firstChild.setAttribute('fill', waferColor(w));
    }

    for (let i = 1; i <= 5; i++) {
        const dots = PV.lpDots[i];
        LP[i].slots.forEach((w, k) => {
            let c = '#1a2436';
            if (w) c = w.state === 'atLP' ? '#7d8ea8' : w.state === 'returned' ? waferColor(w) : 'none';
            dots[k].setAttribute('fill', c);
            dots[k].setAttribute('stroke', w && w.state !== 'atLP' && w.state !== 'returned' ? '#b56cff' : 'none');
        });
    }

    for (const n in PV.ll) {
        const ll = stations[n], v = PV.ll[n];
        const f = clamp(Math.log(ll.press / P_LL_VAC) / Math.log(P_ATM / P_LL_VAC), 0, 1);
        v.fill.setAttribute('height', (64 * f).toFixed(1));
        v.fill.setAttribute('y', (ll.y + 32 - 64 * f).toFixed(1));
        v.fill.setAttribute('fill', ll.alarm ? '#ff4d5e' : ll.mode === 'vac' ? '#3fd0ff' : '#ffb020');
        v.mode.textContent = ll.alarm ? 'ALARM' : ll.mode.toUpperCase();
        v.pr.textContent = fmtPa(ll.press);
    }

    for (let i = 1; i <= 6; i++) {
        const pm = pms[i], v = PV.pm[i];
        let cls = pm.state;
        if (pm.state === 'idle' && pm.assigned) cls = 'assigned';
        v.ring.setAttribute('class', 'pm-ring ' + cls);
        v.sel.setAttribute('opacity', SIM.selPM === i ? 1 : 0);
        const lv = pm.live;
        if (lv && lv.plasma && lv.model) {
            const [R, G, B] = RECIPES[pm.recipeKey].glow;
            v.grad.children[1].setAttribute('stop-color', `rgb(${R},${G},${B})`);
            v.grad.children[2].setAttribute('stop-color', `rgb(${R},${G},${B})`);
            v.glow.setAttribute('opacity', (0.45 + 0.5 * clamp(lv.model.nW / 0.8, 0, 1)) * (0.92 + Math.random() * 0.08));
        } else v.glow.setAttribute('opacity', 0);
        let txt = 'IDLE';
        if (pm.state === 'processing') {
            const st = RECIPES[pm.recipeKey].steps[pm.stepIdx];
            txt = `${stepShort(st)} ${pm.stepT.toFixed(0)}s`;
        } else if (pm.state === 'done') txt = pm.wafer && pm.wafer.aborted ? 'ABORTED' : 'DONE';
        else if (pm.state === 'alarm') txt = 'ALARM';
        else if (pm.assigned) txt = 'RESERVED';
        v.status.textContent = txt;
    }
}

/* =====================================================================
   7. Chamber cross-section (Canvas)
   ===================================================================== */
const CH = {
    cv: null, ctx: null, LW: 640, LH: 440, s: 1, ox: 0, oy: 0,
    ions: [], rads: [], gasIn: [], exh: [], flashes: [], elec: [],
    t: 0, labels: true, field: true, preview: true, hover: null, tourHot: null, mouse: null,
};
const CX = 370, CY0 = 74, MM = 1.35;
const zy = z => CY0 + z * MM;
const WAFER_Y = zy(L_MM);
const BODY = [[285, 74], [455, 74], [455, 196], [495, 214], [495, 388], [245, 388], [245, 214], [285, 196]];

for (let i = 0; i < 40; i++) CH.elec.push({ x0: 292 + Math.random() * 156, ph: Math.random() * 6.28, w: 10 + Math.random() * 8, r: 4 + Math.random() * 4 });

function fitCanvas(cv) {
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w: rect.width, h: rect.height, dpr };
}

function chamberView() {
    const pm = pms[SIM.selPM];
    if (pm.state !== 'idle' || pm.wafer) {
        const r = RECIPES[pm.recipeKey];
        const lv = pm.live || {};
        const st = r.steps[clamp(pm.stepIdx, 0, r.steps.length - 1)];
        return {
            pm, r, plasma: !!lv.plasma, gasOn: !!lv.gasOn, sp: lv.sp, model: lv.model, coils: lv.coils ?? r.hw.coils,
            filmFrac: clamp(1 - pm.removed / r.film.thick, 0, 1), underLoss: pm.underLoss, hasWafer: !!pm.wafer,
            stepName: pm.state === 'processing' ? st.name : pm.state.toUpperCase(), stepT: pm.stepT,
            tW: pm.tW, refl: pm.refl, pressure: pm.pressure, preview: false, oesV: pm.lastOES,
        };
    }
    const r = RECIPES[SIM.recipeKey];
    if (CH.preview) {
        const sp = meStep(r);
        const model = plasmaModel(r, sp, r.hw.coils, r.hw.he);
        return {
            pm, r, plasma: model.ok, gasOn: true, sp, model, coils: r.hw.coils, filmFrac: 1, underLoss: 0, hasWafer: true,
            stepName: 'Idle preview (main-etch settings)', stepT: 0, tW: model.tW, refl: model.ok ? model.refl : 0, pressure: sp.p, preview: true, oesV: model.ok ? 14 * model.nW / 0.55 + 80 * model.nW / 0.55 : 0,
        };
    }
    return { pm, r, plasma: false, gasOn: false, sp: null, model: null, coils: r.hw.coils, filmFrac: 1, underLoss: 0, hasWafer: false, stepName: 'Idle', stepT: 0, tW: pm.tW, refl: 0, pressure: pm.pressure, preview: false, oesV: 0 };
}

function bodyPath(ctx) {
    ctx.beginPath();
    BODY.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
}

function insideBody(x, y) {
    if (y < 74 || y > 388) return false;
    if (y < 200) return x > 287 && x < 453;
    return x > 247 && x < 493;
}

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;

function updateParticles(v, dt) {
    const m = v.model, sp = v.sp;
    const filmPx = v.hasWafer ? 6 * v.filmFrac : 0;
    const surf = WAFER_Y - filmPx;
    const vdc = v.plasma && m ? m.vdc : 0;
    const sheath = v.plasma && m ? 3 + 0.1 * Math.pow(vdc, 0.75) / Math.sqrt(Math.max(m.nW, 0.05)) : 0;
    CH.sheath = sheath;
    CH.surf = surf;

    // ions
    if (v.plasma && m) {
        const yres = zy(Math.min(m.zres, L_MM - 10));
        let n = 140 * m.nW * dt;
        while (n > 0 && CH.ions.length < 280) {
            if (Math.random() < n) {
                CH.ions.push({ x: CX + gauss() * 55, y: lerp(yres, surf - sheath - 4, Math.random()), vx: gauss() * 8, vy: 20 + Math.random() * 25, inSheath: false });
            }
            n -= 1;
        }
    }
    const spread = sp ? 4 + 40 * sp.p / (1 + (m ? m.eIon : 0) / 80) : 10;
    for (const ion of CH.ions) {
        if (ion.y < surf - sheath) {
            ion.vy += 18 * dt;
        } else {
            if (!ion.inSheath) { ion.inSheath = true; ion.vx = gauss() * spread; }
            ion.vy += (300 + 25 * (m ? m.eIon : 0)) * dt * 10;
        }
        ion.x += ion.vx * dt;
        ion.y += ion.vy * dt;
        if (ion.y >= surf && ion.x > 300 && ion.x < 440) {
            ion.dead = true;
            if (Math.random() < 0.5) CH.flashes.push({ x: ion.x, y: surf, life: 0.25 });
        } else if (!insideBody(ion.x, ion.y)) ion.dead = true;
    }
    CH.ions = CH.ions.filter(i => !i.dead);
    if (!v.plasma) CH.ions.length = 0;

    // radicals / neutral gas
    const target = v.gasOn && sp ? (v.plasma && m ? 30 + 90 * m.rad / (m.rad + 0.5) : 30) : 0;
    while (CH.rads.length < target) CH.rads.push({ x: 300 + Math.random() * 140, y: 90 + Math.random() * 240, a: Math.random() * 6.28 });
    if (CH.rads.length > target) CH.rads.length = Math.max(0, Math.floor(target));
    for (const p of CH.rads) {
        p.a += gauss() * 3 * dt;
        p.x += Math.cos(p.a) * 45 * dt;
        p.y += Math.sin(p.a) * 45 * dt;
        if (!insideBody(p.x, p.y) || p.y > surf - 1) { p.a += Math.PI; p.x += Math.cos(p.a) * 3; p.y += Math.sin(p.a) * 3; }
    }

    // gas inlet & exhaust streams
    const flow = sp && v.gasOn ? Object.values(sp.gases).reduce((a, b) => a + b, 0) : 0;
    if (flow > 0 && Math.random() < flow / 200 * dt * 20) {
        CH.gasIn.push({ s: 0, x: 628, y: 98 + Math.random() * 4, tx: SHOWER_HOLES[Math.floor(Math.random() * SHOWER_HOLES.length)] });
    }
    // gas box → riser → plenum between window and shower plate → through holes
    for (const g of CH.gasIn) {
        if (g.s === 0) { g.x -= 140 * dt; if (g.x <= 508) { g.x = 508; g.s = 1; } }
        else if (g.s === 1) { g.y -= 140 * dt; if (g.y <= 62) { g.y = 62 + Math.random() * 2; g.s = 2; } }
        else if (g.s === 2) { g.x -= 160 * dt; if (g.x <= g.tx) { g.x = g.tx - 1; g.s = 3; } }
        else g.y += 70 * dt;
    }
    CH.gasIn = CH.gasIn.filter(g => g.y < 86);
    if (flow > 0 && Math.random() < flow / 200 * dt * 20) CH.exh.push({ x: 462 + Math.random() * 22, y: 386 });
    for (const g of CH.exh) g.y += 60 * dt;
    CH.exh = CH.exh.filter(g => g.y < 440);

    for (const f of CH.flashes) f.life -= dt;
    CH.flashes = CH.flashes.filter(f => f.life > 0);
    for (const e of CH.elec) e.ph += e.w * dt;
}

function label(ctx, text, x, y, align = 'left', color = '#9fb4d3', size = 10) {
    ctx.font = `${size}px Consolas, monospace`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function drawBPlot(ctx, v) {
    const x0 = 22, x1 = 112, bMax = 2000;
    const bx = b => x0 + clamp(b / bMax, 0, 1) * (x1 - x0);
    ctx.strokeStyle = '#24344d';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, CY0, x1 - x0, WAFER_Y - CY0);
    label(ctx, 'B(z) on axis', x0, CY0 - 18, 'left', '#9fb4d3', 10);
    label(ctx, '0', x0, WAFER_Y + 12, 'left', '#5d6f8c', 9);
    label(ctx, '2 kG', x1, WAFER_Y + 12, 'right', '#5d6f8c', 9);
    label(ctx, 'z=0', x0 - 3, CY0 + 4, 'right', '#5d6f8c', 9);
    label(ctx, '200', x0 - 3, WAFER_Y + 3, 'right', '#5d6f8c', 9);

    const xe = bx(B_ECR);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#ffb020aa';
    ctx.beginPath(); ctx.moveTo(xe, CY0); ctx.lineTo(xe, WAFER_Y); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, '875 G', xe + 2, CY0 - 4, 'left', '#ffb020', 9);

    const c = v.coils;
    if (c[0] + c[1] + c[2] <= 0) {
        label(ctx, 'COILS OFF', (x0 + x1) / 2, (CY0 + WAFER_Y) / 2, 'center', '#ff4d5e', 10);
        return;
    }
    ctx.lineWidth = 1;
    COILS.forEach((coil, i) => {
        if (c[i] <= 0) return;
        ctx.strokeStyle = COIL_COLORS[i];
        ctx.beginPath();
        for (let z = 0; z <= L_MM; z += 4) {
            const x = bx(coilField(z, i, c[i])), y = zy(z);
            z ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
    });
    ctx.strokeStyle = '#3fd0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#3fd0ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let z = 0; z <= L_MM; z += 4) {
        const x = bx(bField(z, c)), y = zy(z);
        z ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    const res = resonance(c);
    if (res && res.z <= L_MM) {
        const y = zy(res.z);
        const col = res.highField ? '#ffb020' : '#ff7a45';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(xe, y, 4, 0, 6.28); ctx.fill();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = col + '88';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xe, y); ctx.lineTo(287, y); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, `z=${res.z.toFixed(0)} mm`, xe + 6, y - 5, 'left', col, 9);
        if (!res.highField) label(ctx, 'low-field launch', xe + 6, y + 10, 'left', col, 8);
    } else {
        label(ctx, 'NO RESONANCE', (x0 + x1) / 2, (CY0 + WAFER_Y) / 2, 'center', '#ff4d5e', 10);
    }
}

const COIL_COLORS = ['rgba(255,160,90,0.55)', 'rgba(255,210,120,0.55)', 'rgba(255,120,160,0.55)'];
// [x of left coil, x of right coil, top y, height, width] per coil
const COIL_GEOM = [[238, 460, 78, 50, 42], [238, 460, 134, 52, 42], [203, 499, 222, 60, 38]];

function drawCoils(ctx, v) {
    COIL_GEOM.forEach(([xl, xr, top, h, w], i) => {
        const amps = v.coils[i];
        const on = clamp(amps / COIL_MAX_A, 0, 1);
        for (const x of [xl, xr]) {
            const g = ctx.createLinearGradient(x, 0, x + w, 0);
            g.addColorStop(0, '#5a3418'); g.addColorStop(0.5, '#b8692e'); g.addColorStop(1, '#5a3418');
            ctx.fillStyle = g;
            ctx.shadowColor = '#ff8a3d';
            ctx.shadowBlur = 16 * on;
            ctx.fillRect(x, top, w, h);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#2a1608';
            ctx.strokeRect(x, top, w, h);
            ctx.strokeStyle = '#ffd2a8';
            ctx.lineWidth = 1;
            for (let k = 0; k < 2; k++) {
                const cx = x + w / 2, cy = top + h * (k + 0.5) / 2;
                ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 6.28); ctx.stroke();
                if (x < CX) {
                    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4); ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4); ctx.stroke();
                } else {
                    ctx.fillStyle = '#ffd2a8';
                    ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, 6.28); ctx.fill();
                }
            }
        }
        label(ctx, `${COILS[i].short} ${amps.toFixed(1)}A`, xl - 4, top + h / 2 + 3, 'right', amps > 0 ? '#ffb37a' : '#ff4d5e', 9);
    });
}

function drawFieldLines(ctx, v) {
    const b0 = bField(0, v.coils);
    if (!CH.field || b0 <= 1) return;
    ctx.strokeStyle = `rgba(63,208,255,${0.12 + 0.2 * clamp(b0 / 1500, 0, 1)})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -CH.t * 25;
    for (const x0 of [-70, -46, -24, 0, 24, 46, 70]) {
        ctx.beginPath();
        for (let z = 0; z <= L_MM; z += 5) {
            const x = CX + x0 * clamp(Math.sqrt(b0 / Math.max(bField(z, v.coils), 1)), 0.4, 3), y = zy(z);
            z ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function drawPlasma(ctx, v) {
    const m = v.model;
    if (!v.plasma || !m) return;
    const [R, G, B] = v.r.glow;
    const yres = zy(Math.min(m.zres, L_MM - 10));
    const unstable = v.pm.armed.has('MW_REFL') && !v.preview;
    const flick = unstable ? 0.5 + Math.random() * 0.6 : 0.94 + Math.random() * 0.06;
    const I = clamp(m.nRes / 1.2, 0.2, 1) * flick;
    const Iw = clamp(m.nW / 0.8, 0.1, 1) * flick;
    ctx.globalCompositeOperation = 'lighter';
    const g2 = ctx.createLinearGradient(0, yres, 0, CH.surf);
    g2.addColorStop(0, `rgba(${R},${G},${B},${0.35 * I})`);
    g2.addColorStop(1, `rgba(${R},${G},${B},${0.22 * Iw})`);
    ctx.fillStyle = g2;
    ctx.fillRect(245, yres, 250, CH.surf - CH.sheath - yres);
    const g3 = ctx.createRadialGradient(CX, CH.surf - 40, 10, CX, CH.surf - 40, 150);
    g3.addColorStop(0, `rgba(${R},${G},${B},${0.3 * Iw})`);
    g3.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.fillStyle = g3;
    ctx.fillRect(245, yres, 250, CH.surf - CH.sheath - yres);
    const g = ctx.createRadialGradient(CX, yres, 4, CX, yres, 140);
    g.addColorStop(0, `rgba(255,255,255,${0.6 * I})`);
    g.addColorStop(0.12, `rgba(${R},${G},${B},${0.55 * I})`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(245, 74, 250, 314);
    ctx.globalCompositeOperation = 'source-over';
}

function drawResonance(ctx, v) {
    const zr = resonanceZ(v.coils);
    if (zr === null || zr > L_MM) return;
    const y = zy(zr);
    const xl = y < 200 ? 287 : 247, xr = y < 200 ? 453 : 493;
    if (v.plasma) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, y - 8, 0, y + 8);
        g.addColorStop(0, 'rgba(255,200,80,0)'); g.addColorStop(0.5, 'rgba(255,220,140,0.55)'); g.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = g;
        ctx.fillRect(xl, y - 8, xr - xl, 16);
        for (const e of CH.elec) {
            const x = e.x0 + Math.cos(e.ph) * e.r, yy = y + Math.sin(e.ph) * e.r * 0.35;
            ctx.fillStyle = 'rgba(200,240,255,0.9)';
            ctx.beginPath(); ctx.arc(x, yy, 1.4, 0, 6.28); ctx.fill();
            ctx.strokeStyle = 'rgba(160,220,255,0.35)';
            ctx.beginPath(); ctx.ellipse(e.x0, y, e.r, e.r * 0.35, 0, e.ph - 1.2, e.ph); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
    } else {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#ffb02066';
        ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(xr, y); ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawParticles(ctx, v) {
    const [R, G, B] = v.r.glow;
    for (const p of CH.rads) {
        ctx.fillStyle = v.plasma ? `rgba(${(R + 255) >> 1},${(G + 255) >> 1},${(B + 255) >> 1},0.45)` : 'rgba(160,175,200,0.35)';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const ion of CH.ions) {
        const sp = Math.hypot(ion.vx, ion.vy);
        const k = clamp(sp / 900, 0.02, 0.05);
        ctx.strokeStyle = ion.inSheath ? 'rgba(255,110,110,0.95)' : 'rgba(255,140,140,0.7)';
        ctx.lineWidth = ion.inSheath ? 1.6 : 1.2;
        ctx.beginPath(); ctx.moveTo(ion.x, ion.y); ctx.lineTo(ion.x - ion.vx * k, ion.y - ion.vy * k); ctx.stroke();
    }
    for (const f of CH.flashes) {
        ctx.fillStyle = `rgba(255,230,180,${f.life * 3})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.5, 0, 6.28); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
}

function drawSheath(ctx, v) {
    if (!v.plasma || !v.hasWafer || CH.sheath <= 0) return;
    const top = CH.surf - CH.sheath;
    ctx.fillStyle = 'rgba(4,6,12,0.75)';
    ctx.fillRect(296, top, 148, CH.sheath);
    ctx.strokeStyle = 'rgba(255,120,120,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(296, top); ctx.lineTo(444, top); ctx.stroke();
    ctx.setLineDash([]);
    if (v.model && v.model.vdc > 5 && CH.sheath > 6) {
        ctx.strokeStyle = 'rgba(255,150,150,0.5)';
        for (let x = 310; x < 440; x += 22) {
            ctx.beginPath(); ctx.moveTo(x, top + 1); ctx.lineTo(x, CH.surf - 2); ctx.lineTo(x - 2, CH.surf - 4); ctx.moveTo(x, CH.surf - 2); ctx.lineTo(x + 2, CH.surf - 4); ctx.stroke();
        }
    }
}

function drawStage(ctx, v) {
    // focus ring, ESC, pedestal
    ctx.fillStyle = '#6a7f99';
    ctx.fillRect(286, WAFER_Y + 1, 12, 8);
    ctx.fillRect(442, WAFER_Y + 1, 12, 8);
    const g = ctx.createLinearGradient(0, WAFER_Y + 5, 0, WAFER_Y + 28);
    g.addColorStop(0, '#46597a'); g.addColorStop(1, '#222d40');
    ctx.fillStyle = g;
    ctx.fillRect(290, WAFER_Y + 5, 160, 23);
    ctx.fillStyle = '#1b2433';
    ctx.fillRect(346, WAFER_Y + 28, 48, 16);
    ctx.fillRect(362, 388, 16, 18);
    label(ctx, 'ESC', CX, WAFER_Y + 20, 'center', '#c9d6ea', 9);

    if (v.hasWafer) {
        ctx.fillStyle = '#a4adb8';
        ctx.fillRect(300, WAFER_Y, 140, 5);
        ctx.fillStyle = v.r.under.color;
        ctx.fillRect(300, WAFER_Y - 1.2, 140, 1.2);
        const fp = 6 * v.filmFrac;
        if (fp > 0.05) {
            ctx.fillStyle = v.r.film.color;
            ctx.fillRect(300, WAFER_Y - 1.2 - fp, 140, fp);
        }
    }

    // He backside line
    ctx.strokeStyle = '#2d6f99';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(196, WAFER_Y + 18); ctx.lineTo(290, WAFER_Y + 18); ctx.stroke();
    ctx.lineWidth = 1;
    if (v.gasOn && v.hasWafer) {
        ctx.fillStyle = '#7fd8ff';
        for (let k = 0; k < 5; k++) {
            const x = 196 + ((CH.t * 50 + k * 19) % 94);
            ctx.fillRect(x, WAFER_Y + 17, 2, 2);
        }
        ctx.fillStyle = 'rgba(127,216,255,0.6)';
        for (let x = 304; x < 438; x += 9) ctx.fillRect(x, WAFER_Y + 5, 2, 1);
    }

    // RF bias feed
    const rfOn = v.plasma && v.sp && v.sp.bias > 0;
    ctx.strokeStyle = rfOn ? '#ff6b6b' : '#3a4a63';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(370, 406); ctx.lineTo(370, 418); ctx.lineTo(356, 418); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#121b2b';
    ctx.strokeStyle = rfOn ? '#ff6b6b' : '#33435e';
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = rfOn ? 10 : 0;
    ctx.fillRect(256, 404, 100, 30);
    ctx.strokeRect(256, 404, 100, 30);
    ctx.shadowBlur = 0;
    label(ctx, 'RF BIAS + MATCH', 306, 416, 'center', '#ffb3b3', 9);
    label(ctx, `${v.sp && v.plasma ? v.sp.bias : 0} W`, 306, 428, 'center', '#fff', 10);
}

const SHOWER_HOLES = Array.from({ length: 18 }, (_, k) => 292 + k * 9);

function drawTopAssembly(ctx, v) {
    ctx.fillStyle = '#2a3446';
    ctx.strokeStyle = '#5a6f90';
    ctx.fillRect(280, 50, 180, 26);
    ctx.strokeRect(280, 50, 180, 26);
    // microwave window
    ctx.fillStyle = 'rgba(150,220,255,0.28)';
    ctx.strokeStyle = 'rgba(150,220,255,0.75)';
    ctx.fillRect(285, 52, 170, 8);
    ctx.strokeRect(285, 52, 170, 8);
    // gas plenum
    ctx.fillStyle = v.gasOn ? 'rgba(57,217,138,0.22)' : '#0a111c';
    ctx.fillRect(285, 60, 175, 7);
    // perforated shower plate
    ctx.fillStyle = 'rgba(150,220,255,0.38)';
    ctx.fillRect(285, 67, 170, 7);
    ctx.strokeRect(285, 67, 170, 7);
    ctx.fillStyle = v.gasOn ? 'rgba(120,240,170,0.9)' : '#0a111c';
    for (const hx of SHOWER_HOLES) ctx.fillRect(hx - 0.75, 67, 1.5, 7);
}

function drawWaveguide(ctx, v) {
    ctx.fillStyle = '#1a2230';
    ctx.strokeStyle = '#4a5d7d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(346, 50); ctx.lineTo(346, 20); ctx.lineTo(520, 20); ctx.lineTo(520, 46); ctx.lineTo(394, 46); ctx.lineTo(394, 50);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1;
    drawTopAssembly(ctx, v);
    // magnetron
    const mwOn = v.plasma || (v.pm.state === 'processing' && v.r.steps[v.pm.stepIdx] && v.r.steps[v.pm.stepIdx].type === 'ignite');
    ctx.fillStyle = '#2a1d10';
    ctx.strokeStyle = mwOn ? '#ffb020' : '#5a4a30';
    ctx.shadowColor = '#ffb020';
    ctx.shadowBlur = mwOn ? 12 : 0;
    ctx.fillRect(520, 12, 96, 42);
    ctx.strokeRect(520, 12, 96, 42);
    ctx.shadowBlur = 0;
    label(ctx, 'MAGNETRON', 568, 26, 'center', '#ffcf7a', 9);
    label(ctx, `2.45 GHz ${mwOn && v.sp ? v.sp.mw : 0} W`, 568, 40, 'center', '#fff', 9);
    label(ctx, 'tuner', 470, 15, 'center', '#5d6f8c', 8);
    ctx.fillStyle = '#4a5d7d';
    for (const x of [452, 468, 484]) ctx.fillRect(x - 2, 14, 4, 8);

    if (mwOn && v.sp) {
        const a = clamp(v.sp.mw / 1500, 0.3, 1);
        ctx.strokeStyle = `rgba(255,190,70,${a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let x = 518; x >= 372; x -= 2) {
            const y = 33 + Math.sin((x + CH.t * 160) / 7) * 6;
            x === 518 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        for (let y = 33; y <= 74; y += 2) ctx.lineTo(370 + Math.sin((y - CH.t * 160) / 7) * 14, y);
        ctx.stroke();
        if (v.refl > 10) {
            ctx.strokeStyle = 'rgba(255,77,94,0.8)';
            ctx.beginPath();
            for (let x = 372; x <= 518; x += 2) {
                const y = 33 + Math.sin((x - CH.t * 160) / 5) * 4;
                x === 372 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.lineWidth = 1;
    }
}

function drawGasAndPump(ctx, v) {
    // gas box & line
    ctx.fillStyle = '#122016';
    ctx.strokeStyle = v.gasOn ? '#39d98a' : '#2b4a35';
    ctx.fillRect(560, 84, 76, 32);
    ctx.strokeRect(560, 84, 76, 32);
    label(ctx, 'GAS BOX / MFC', 598, 97, 'center', '#9fd9b5', 8);
    const flow = v.sp && v.gasOn ? Object.values(v.sp.gases).reduce((a, b) => a + b, 0) : 0;
    label(ctx, `${flow.toFixed(0)} sccm`, 598, 110, 'center', '#fff', 9);
    ctx.fillStyle = '#26354d';
    ctx.fillRect(505, 97, 55, 7);
    ctx.fillRect(505, 59, 7, 45);
    ctx.fillRect(455, 59, 57, 7);
    ctx.fillStyle = '#9fd9b5';
    for (const g of CH.gasIn) ctx.fillRect(g.x, g.y, 2, 2);

    // exhaust, APC, turbo
    ctx.fillStyle = '#0a111c';
    ctx.fillRect(458, 388, 30, 14);
    ctx.strokeStyle = '#4a5d7d';
    ctx.strokeRect(458, 388, 30, 14);
    const open = v.sp && v.gasOn ? clamp(1 - v.pressure / 2.5, 0.1, 1) : 1;
    ctx.strokeStyle = '#c9d6ea';
    ctx.lineWidth = 2;
    const ang = open * Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(473 - 13 * Math.cos(ang), 395 - 5 * Math.sin(ang)); ctx.lineTo(473 + 13 * Math.cos(ang), 395 + 5 * Math.sin(ang)); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#141d2c';
    ctx.fillRect(446, 404, 54, 32);
    ctx.strokeRect(446, 404, 54, 32);
    ctx.strokeStyle = '#7d8ea8';
    for (let k = 0; k < 6; k++) {
        const a = CH.t * 18 + k * Math.PI / 3;
        ctx.beginPath(); ctx.moveTo(473, 420); ctx.lineTo(473 + Math.cos(a) * 12, 420 + Math.sin(a) * 5); ctx.stroke();
    }
    label(ctx, 'TMP', 504, 418, 'left', '#7d8ea8', 9);
    label(ctx, 'APC', 492, 398, 'left', '#7d8ea8', 9);
    ctx.fillStyle = 'rgba(160,175,200,0.5)';
    for (const g of CH.exh) ctx.fillRect(g.x, g.y, 2, 2);
}

function drawOESPort(ctx, v) {
    ctx.fillStyle = 'rgba(150,220,255,0.5)';
    ctx.fillRect(241, 292, 6, 18);
    ctx.strokeStyle = '#2b3c58';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(241, 301); ctx.bezierCurveTo(220, 301, 215, 301, 196, 301); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#0f1828';
    ctx.strokeStyle = '#33435e';
    ctx.fillRect(126, 288, 70, 28);
    ctx.strokeRect(126, 288, 70, 28);
    label(ctx, 'OES', 161, 299, 'center', '#c9d6ea', 9);
    label(ctx, `${v.r.epd.wl} nm`, 161, 311, 'center', wlColor(v.r.epd.wl), 9);
    if (v.plasma) {
        const a = clamp((v.oesV || 0) / 110, 0.05, 0.6);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(CX, 0, 247, 0);
        g.addColorStop(0, wlColor(v.r.epd.wl, 0));
        g.addColorStop(1, wlColor(v.r.epd.wl, a));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(CX, 270); ctx.lineTo(247, 294); ctx.lineTo(247, 308); ctx.lineTo(CX, 320); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }
}

function drawReadout(ctx, v) {
    const x = 544, y = 128;
    ctx.fillStyle = 'rgba(10,17,28,0.85)';
    ctx.strokeStyle = '#1f2c42';
    ctx.fillRect(x, y, 94, 256);
    ctx.strokeRect(x, y, 94, 256);
    const m = v.model, sp = v.sp, on = v.plasma, c = v.coils;
    const rows = [
        ['µW', on && sp ? `${sp.mw} W` : '0 W'],
        ['Refl', `${(v.refl || 0).toFixed(1)} %`, v.refl > 15 ? '#ff4d5e' : v.refl > 8 ? '#ffb020' : null],
        ['Bias', on && sp ? `${sp.bias} W` : '0 W'],
        ['Vdc', on && m ? `-${m.vdc.toFixed(0)} V` : '—'],
        ['Ion E', on && m ? `${m.eIon.toFixed(0)} eV` : '—'],
        ['P', v.pressure >= 0.01 ? `${v.pressure.toFixed(2)} Pa` : v.pressure.toExponential(0) + ' Pa'],
        ['U/M/L', `${c.map(a => a.toFixed(0)).join('/')} A`, c[0] + c[1] + c[2] === 0 ? '#ff4d5e' : null],
        ['B win', `${bField(0, c).toFixed(0)} G`, bField(0, c) < B_ECR ? '#ffb020' : null],
        ['B waf', `${bField(L_MM, c).toFixed(0)} G`],
        ['He', `${v.r.hw.he} Pa`],
        ['Twafer', `${v.tW.toFixed(0)} °C`, v.tW > 130 ? '#ff4d5e' : v.tW > 90 ? '#ffb020' : null],
        ['ER', on && m ? `${m.er.toFixed(0)} nm/m` : '—'],
        ['Film', `${(v.filmFrac * v.r.film.thick).toFixed(0)}/${v.r.film.thick}`],
        ['Under', `-${v.underLoss.toFixed(2)} nm`, v.underLoss > v.r.under.thick ? '#ff4d5e' : null],
    ];
    rows.forEach((rw, i) => {
        label(ctx, rw[0], x + 5, y + 15 + i * 17.5, 'left', '#7d8ea8', 9);
        label(ctx, rw[1], x + 89, y + 15 + i * 17.5, 'right', rw[2] || '#e6eefb', 9);
    });
}

function drawStatus(ctx, v) {
    const pm = v.pm;
    const stateCol = { idle: '#ffb020', processing: '#b56cff', done: '#39d98a', alarm: '#ff4d5e' }[pm.state];
    label(ctx, pm.name, 8, 16, 'left', '#3fd0ff', 13);
    label(ctx, pm.state.toUpperCase(), 48, 16, 'left', stateCol, 11);
    label(ctx, `${v.r.name}`, 8, 32, 'left', '#9fb4d3', 10);
    const wl = pm.wafer ? pm.wafer.label : (v.preview ? 'preview' : 'no wafer');
    label(ctx, `${wl} · ${v.stepName}${pm.state === 'processing' ? ' ' + v.stepT.toFixed(1) + ' s' : ''}`, 8, 46, 'left', '#e6eefb', 10);
}

function drawLabels(ctx, v) {
    if (!CH.labels) return;
    const L = (t, x, y, a = 'left') => label(ctx, t, x, y, a, '#c9d6ea', 9);
    L('waveguide', 342, 34, 'right');
    label(ctx, 'quartz window', 276, 58, 'right', '#c9d6ea', 8);
    label(ctx, 'shower plate', 276, 73, 'right', '#c9d6ea', 8);
    L('solenoids', 234, 92, 'right');
    const zr = resonanceZ(v.coils);
    if (zr !== null && zr < L_MM) L('ECR 875 G', 452, zy(zr) - 4, 'right');
    if (v.plasma) L('plasma', 292, zy(Math.min(zr ?? 100, 180)) + 40);
    if (v.plasma && CH.sheath > 0) label(ctx, 'sheath', 300, CH.surf - CH.sheath - 3, 'left', '#ff9a9a', 9);
    L('He', 200, WAFER_Y + 14);
    L('gas in', 516, 94);
    if (v.hasWafer) label(ctx, v.r.film.name, 440, WAFER_Y - 10, 'right', v.r.film.color, 9);
}

function chamberHotspots(v) {
    const list = [
        ['magnetron', 520, 12, 96, 42], ['waveguide', 346, 14, 174, 34], ['quartz', 285, 50, 170, 10], ['shower', 285, 60, 170, 16],
        ['bfield', 10, 52, 108, 300],
        ...COIL_GEOM.flatMap(([xl, xr, top, h, w]) => [['coils', xl - 44, top, w + 44, h], ['coils', xr, top, w, h]]),
        ['gas', 504, 56, 132, 60], ['pump', 444, 386, 66, 52], ['oes', 124, 286, 124, 32],
        ['rf', 254, 402, 104, 34], ['he', 194, WAFER_Y + 8, 96, 16], ['esc', 288, WAFER_Y + 5, 164, 24],
    ];
    const zr = resonanceZ(v.coils);
    if (zr !== null && zr < L_MM) list.push(['ecr', 287, zy(zr) - 8, 166, 16]);
    if (v.plasma && CH.sheath > 0) list.push(['sheath', 296, CH.surf - CH.sheath - 3, 148, CH.sheath + 3]);
    if (v.hasWafer) list.push(['wafer', 300, WAFER_Y - 9, 140, 14]);
    list.push(['ions', 290, 220, 160, 100], ['plasma', 287, 76, 166, 140]);
    return list;
}

function drawHover(ctx, v) {
    const draw = (id, color) => {
        for (const h of chamberHotspots(v)) {
            if (h[0] !== id) continue;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(h[1] - 2, h[2] - 2, h[3] + 4, h[4] + 4);
        }
    };
    if (CH.tourHot) draw(CH.tourHot, `rgba(181,108,255,${0.5 + 0.5 * Math.sin(CH.t * 5)})`);
    if (CH.hover) draw(CH.hover, '#3fd0ff');
    ctx.lineWidth = 1;
}

function renderChamber(dt) {
    const cv = CH.cv, ctx = CH.ctx;
    const { w, h, dpr } = fitCanvas(cv);
    CH.s = Math.min(w / CH.LW, h / CH.LH);
    CH.ox = (w - CH.LW * CH.s) / 2;
    CH.oy = (h - CH.LH * CH.s) / 2;
    CH.t += dt;
    const v = chamberView();
    CH.view = v;
    updateParticles(v, dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * CH.s, 0, 0, dpr * CH.s, dpr * CH.ox, dpr * CH.oy);

    drawBPlot(ctx, v);
    drawCoils(ctx, v);
    bodyPath(ctx);
    const bg = ctx.createLinearGradient(0, 74, 0, 388);
    bg.addColorStop(0, '#070b14'); bg.addColorStop(1, '#0a0f1a');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.save();
    bodyPath(ctx);
    ctx.clip();
    drawFieldLines(ctx, v);
    drawPlasma(ctx, v);
    drawResonance(ctx, v);
    drawParticles(ctx, v);
    drawSheath(ctx, v);
    ctx.restore();
    bodyPath(ctx);
    ctx.strokeStyle = '#5a6f90';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1;
    drawStage(ctx, v);
    drawWaveguide(ctx, v);
    drawGasAndPump(ctx, v);
    drawOESPort(ctx, v);
    drawReadout(ctx, v);
    drawStatus(ctx, v);
    drawLabels(ctx, v);
    drawHover(ctx, v);
    if (v.preview) label(ctx, 'IDLE PREVIEW', CX, 240, 'center', 'rgba(255,255,255,0.18)', 22);
    if (v.pm.state === 'alarm') label(ctx, '⚠ ALARM', CX, 240, 'center', `rgba(255,77,94,${0.5 + 0.5 * Math.sin(CH.t * 8)})`, 24);
}

function chamberHit(e) {
    const rect = CH.cv.getBoundingClientRect();
    const x = (e.clientX - rect.left - CH.ox) / CH.s, y = (e.clientY - rect.top - CH.oy) / CH.s;
    if (!CH.view) return null;
    for (const h of chamberHotspots(CH.view)) if (x >= h[1] && x <= h[1] + h[3] && y >= h[2] && y <= h[2] + h[4]) return h[0];
    return null;
}

/* =====================================================================
   8. Recipe knobs, predicted metrics, step table
   ===================================================================== */
function buildRecipeSelect() {
    const sel = $('#recipeSel');
    sel.innerHTML = '';
    for (const k in RECIPES) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = `${RECIPES[k].fromCsv ? '[CSV] ' : ''}${RECIPES[k].name} (${RECIPES[k].chem})`;
        sel.appendChild(o);
    }
    sel.value = SIM.recipeKey;
}

function buildKnobs() {
    const r = RECIPES[SIM.recipeKey], me = meStep(r);
    const defs = [
        { label: 'Microwave power', unit: 'W', min: 200, max: 1500, step: 10, dec: 0, obj: me, key: 'mw', topic: 'magnetron', hint: 'mw' },
        { label: 'RF bias power', unit: 'W', min: 0, max: 300, step: 1, dec: 0, obj: me, key: 'bias', topic: 'rf', hint: 'bias' },
        { label: 'Pressure', unit: 'Pa', min: 0.1, max: 2, step: 0.01, dec: 2, obj: me, key: 'p', topic: 'pressure', hint: 'p' },
        ...COILS.map((c, i) => ({ label: `${c.name} coil`, unit: 'A', min: 0, max: COIL_MAX_A, step: 0.5, dec: 1, obj: r.hw.coils, key: i, topic: 'coils', hint: 'coil' + c.short })),
        { label: 'He backside', unit: 'Pa', min: 0, max: 2000, step: 10, dec: 0, obj: r.hw, key: 'he', topic: 'he', hint: 'he' },
        ...Object.keys(me.gases).map(g => ({ label: g + ' flow', unit: 'sccm', min: 0, max: g === 'O2' ? 20 : 200, step: 1, dec: 0, obj: me.gases, key: g, topic: 'gas', hint: 'gas', gas: true })),
    ];
    const box = $('#knobs');
    box.innerHTML = '';
    for (const d of defs) {
        const row = document.createElement('div');
        row.className = 'knob' + (d.gas ? ' gas' : '');
        const lab = document.createElement('label');
        lab.textContent = d.label;
        lab.title = 'Click for explanation';
        lab.addEventListener('click', () => showTopic(d.topic));
        const inp = document.createElement('input');
        // imported recipes can exceed the default slider range
        const max = d.obj === r.hw.coils ? d.max : Math.max(d.max, Math.ceil(d.obj[d.key] * 1.5));
        Object.assign(inp, { type: 'range', min: d.min, max, step: d.step, value: d.obj[d.key] });
        const val = document.createElement('span');
        val.className = 'val';
        const show = () => { val.textContent = `${Number(d.obj[d.key]).toFixed(d.dec)} ${d.unit}`; };
        show();
        inp.addEventListener('input', () => {
            d.obj[d.key] = parseFloat(inp.value);
            show();
            $('#knobHint').innerHTML = KNOB_HINTS[d.hint];
            updateMetrics();
            buildStepsTable(true);
        });
        inp.addEventListener('focus', () => { $('#knobHint').innerHTML = KNOB_HINTS[d.hint]; });
        row.append(lab, inp, val);
        box.appendChild(row);
    }
    $('#knobHint').innerHTML = 'Knobs edit the <b>main-etch</b> step; the three coils &amp; He apply to every step. Changes affect running wafers immediately.';
}

function updateMetrics() {
    const r = RECIPES[SIM.recipeKey], me = meStep(r);
    const m = plasmaModel(r, me, r.hw.coils, r.hw.he);
    const est = m.er > 0 ? r.film.thick / m.er * 60 : Infinity;
    const limT = me.dur || r.epd.maxTime;
    const nomEr = r.nominal.er, nomSel = r.nominal.sel;
    const items = [
        ['ECR zone (z from window)', m.zres === null ? 'none' : `${m.zres.toFixed(0)} mm${m.highField ? '' : ' · low-field'}`, m.zres === null ? 0 : m.zres / L_MM,
            m.zres === null ? 'bad' : m.zres > 170 || !m.highField ? 'warn' : '', 'ecr'],
        ['Field expansion zone→wafer', `${m.X.toFixed(1)}× (B wafer ${m.bW.toFixed(0)} G)`, m.X / 10,
            m.X < 1.5 || m.X > 12 ? 'bad' : m.X < 2.5 || m.X > 8 ? 'warn' : '', 'bfield'],
        ['Ion density @ wafer', m.ok ? `${m.nW.toFixed(2)}×10¹¹ cm⁻³` : 'NO PLASMA', m.nW / 1.2, !m.ok || m.nW < 0.15 ? 'bad' : m.nW < 0.3 ? 'warn' : '', 'plasma'],
        ['Ion energy (Vp+Vdc)', `${m.eIon.toFixed(0)} eV`, m.eIon / 500, m.eIon > 350 ? 'warn' : '', 'sheath'],
        ['Etch rate', `${m.er.toFixed(0)} nm/min`, m.er / (nomEr * 2), m.er < nomEr * 0.2 ? 'bad' : m.er < nomEr * 0.5 ? 'warn' : '', 'm_er'],
        [`Selectivity to ${escapeHtml(r.under.name)}`, m.ok ? (m.sel >= 999 ? '>999' : m.sel.toFixed(m.sel < 10 ? 1 : 0)) : '—', Math.log10(m.sel) / 3,
        m.sel < nomSel * 0.25 ? 'bad' : m.sel < nomSel * 0.6 ? 'warn' : '', 'm_sel'],
        ['Anisotropy / angle', m.ok ? `${m.anis.toFixed(3)} / ${m.angle.toFixed(1)}°` : '—', m.anis, m.anis < 0.8 ? 'bad' : m.anis < 0.92 ? 'warn' : '', 'm_anis'],
        ['Uniformity (1σ)', `±${m.uni.toFixed(1)} %`, m.uni / 10, m.uni > 6 ? 'bad' : m.uni > 3 ? 'warn' : '', 'm_uni'],
        ['Wafer temperature', `${m.tW.toFixed(0)} °C`, m.tW / 150, m.tW > 130 ? 'bad' : m.tW > 90 ? 'warn' : '', 'he'],
        ['Reflected µW (tuned)', `${m.refl.toFixed(1)} %`, m.refl / 20, m.refl > 15 ? 'bad' : m.refl > 8 ? 'warn' : '', 'waveguide'],
        ...(me.dur ? [[
            'Main-step removal (timed)', `${(m.er * me.dur / 60).toFixed(1)} nm → ${Math.max(0, r.film.thick - m.er * me.dur / 60).toFixed(1)} nm left`,
            m.er * me.dur / 60 / r.film.thick, m.er * me.dur / 60 > r.film.thick ? 'warn' : '', 'm_time',
        ]] : [[
            'Est. main-etch time', isFinite(est) ? `${est.toFixed(0)} s (max ${limT})` : '∞', isFinite(est) ? est / limT : 1,
            est > limT ? 'bad' : est > limT * 0.7 ? 'warn' : '', 'm_time',
        ]]),
    ];
    $('#metrics').innerHTML = items.map(([k, v, f, st, topic]) =>
        `<div class="metric ${st}" data-topic="${topic}"><div class="k">${k}</div><div class="v">${v}</div><div class="bar"><i style="width:${(clamp(f, 0, 1) * 100).toFixed(0)}%"></i></div></div>`
    ).join('');
}

function displayedRecipeKey() {
    const pm = pms[SIM.selPM];
    return pm.recipeKey && (pm.state !== 'idle' || pm.wafer) ? pm.recipeKey : SIM.recipeKey;
}

let stepsTableKey = null;
function buildStepsTable(force = false) {
    const key = displayedRecipeKey();
    if (!force && key === stepsTableKey) return;
    stepsTableKey = key;
    const r = RECIPES[key];
    $('#recipeTitle').textContent = `${r.name} · ${r.film.thick} nm ${r.film.name} on ${r.under.name}`;
    $('#stepsBody').innerHTML = r.steps.map((s, i) => {
        let time = s.dur ? `${s.dur} s` : '';
        if (s.type === 'me') time = s.dur ? `${s.dur} s · EPD mon.` : `EPD ≤${r.epd.maxTime}s`;
        if (s.type === 'oe') time = `${s.overPct}% ME`;
        const plasma = PLASMA_STEPS.includes(s.type);
        const gases = plasma ? Object.entries(s.gases).map(([g, f]) => `${g} ${f}`).join(' · ') : '—';
        const tip = plasma ? ` title="Coils U/M/L ${(s.coils || r.hw.coils).join(' / ')} A${s.note ? ' · ' + escapeHtml(s.note) : ''}"` : '';
        return `<tr data-i="${i}" data-topic="step_${s.type}"${tip}><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${time}</td>` +
            `<td>${plasma ? s.mw : '—'}</td><td>${plasma ? s.bias : '—'}</td><td>${plasma ? s.p.toFixed(2) : '—'}</td><td>${gases}</td></tr>`;
    }).join('');
}

function updateStepsHighlight() {
    buildStepsTable();
    const pm = pms[SIM.selPM];
    const active = (pm.state === 'processing' || pm.state === 'alarm') && pm.recipeKey === stepsTableKey;
    const r = RECIPES[stepsTableKey];
    const rows = $('#stepsBody').children;
    for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        let cls = '';
        if (active && i < pm.stepIdx) cls = 'donestep';
        if (active && i === pm.stepIdx) {
            cls = pm.state === 'alarm' ? 'cur alarmstep' : 'cur';
            const st = r.steps[i];
            let pct = st.dur ? pm.stepT / st.dur : 0;
            if (st.type === 'me') pct = st.dur ? pm.stepT / st.dur : pm.removed / r.film.thick;
            if (st.type === 'oe') pct = pm.stepT / oeDur(pm, st);
            tr.style.setProperty('--pct', (clamp(pct, 0, 1) * 100).toFixed(1) + '%');
        }
        if (pm.state === 'done' && pm.recipeKey === stepsTableKey) cls = 'donestep';
        if (tr.className !== cls) tr.className = cls;
    }
    const res = pm.lastResult;
    let html = '';
    if (pm.wafer) html += `<b>${pm.wafer.label}</b> in ${pm.name} · ${pm.state}. `;
    if (res) {
        const punch = res.under > res.underThick;
        const cleared = res.post < 0.05;
        html += `Last wafer <b>${res.label}</b>: ${escapeHtml(res.filmName)} <b>${res.pre.toFixed(1)} → ${res.post.toFixed(1)} nm</b> ` +
            `(${((res.pre - res.post) * 10).toFixed(0)} Å removed), ME <b>${res.me.toFixed(1)} s</b>, ` +
            `endpoint ${res.ep ? '<span class="ok">OK</span>' : cleared ? '<span class="bad">none</span>' : 'n/a (film not cleared)'}` +
            (cleared ? `, ${escapeHtml(res.underName)} loss <b class="${punch ? 'bad' : 'ok'}">${res.under.toFixed(2)} nm</b>${punch ? ' — punch-through!' : ''}` : '');
    }
    if (!html) html = 'No wafer processed yet in this chamber.';
    const el = $('#waferResult');
    if (el.innerHTML !== html) el.innerHTML = html;
}

/* =====================================================================
   9. OES chart & spectrum
   ===================================================================== */
const OES = { cv: null, ctx: null };

function renderOES() {
    const { w, h, dpr } = fitCanvas(OES.cv);
    const ctx = OES.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pm = pms[SIM.selPM];
    const v = CH.view;
    const r = RECIPES[pm.recipeKey && (pm.state !== 'idle' || pm.wafer || pm.oes.length) ? pm.recipeKey : SIM.recipeKey];
    $('#oesTitle').textContent = `${r.epd.species} ${r.epd.wl} nm · ${pm.name}`;

    const specW = Math.min(240, w * 0.32);
    const L = 42, T = 14, R = w - specW - 16, B = h - 26;
    const data = pm.oes;
    const tMax = Math.max(60, data.length ? data[data.length - 1].t * 1.08 : 0);
    let vMax = 110;
    for (const d of data) vMax = Math.max(vMax, d.v * 1.1);
    const X = t => L + (t / tMax) * (R - L), Y = val => B - (val / vMax) * (B - T);

    ctx.strokeStyle = '#18233a';
    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#5d6f8c';
    ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
        const val = vMax * k / 4, y = Y(val);
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
        ctx.fillText(val.toFixed(0), L - 4, y + 3);
    }
    ctx.textAlign = 'center';
    const tStep = tMax > 200 ? 50 : tMax > 100 ? 20 : 10;
    for (let t = 0; t <= tMax; t += tStep) {
        ctx.beginPath(); ctx.moveTo(X(t), T); ctx.lineTo(X(t), B); ctx.stroke();
        ctx.fillText(t + ' s', X(t), B + 13);
    }
    ctx.save();
    ctx.translate(11, (T + B) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('intensity (a.u.)', 0, 0);
    ctx.restore();

    for (const mk of pm.marks) {
        ctx.strokeStyle = '#33435e';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(X(mk.t), T); ctx.lineTo(X(mk.t), B); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7d8ea8';
        ctx.textAlign = 'left';
        ctx.fillText(mk.name, X(mk.t) + 2, T + 9);
    }

    const e = pm.epd;
    if (e && e.ref !== null) {
        const x0 = X(e.refT), x1 = e.hit ? X(e.hitT) : X(data.length ? data[data.length - 1].t : e.refT);
        ctx.strokeStyle = '#3fd0ff66';
        ctx.beginPath(); ctx.moveTo(x0, Y(e.ref)); ctx.lineTo(x1, Y(e.ref)); ctx.stroke();
        ctx.strokeStyle = '#ffb020';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(x0, Y(e.thr)); ctx.lineTo(Math.max(x1, x0 + 30), Y(e.thr)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffb020';
        ctx.textAlign = 'left';
        ctx.fillText(`threshold −${(r.epd.drop * 100).toFixed(0)}%`, x0 + 4, Y(e.thr) - 4);
    }
    if (e && e.hit) {
        const x = X(e.hitT);
        ctx.strokeStyle = '#39d98a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#39d98a';
        ctx.textAlign = 'left';
        ctx.fillText('ENDPOINT', x + 4, T + 22);
    }

    if (data.length > 1) {
        ctx.strokeStyle = wlColor(r.epd.wl);
        ctx.shadowColor = wlColor(r.epd.wl);
        ctx.shadowBlur = 6;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        data.forEach((d, i) => i ? ctx.lineTo(X(d.t), Y(d.v)) : ctx.moveTo(X(d.t), Y(d.v)));
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
    } else {
        ctx.fillStyle = '#5d6f8c';
        ctx.textAlign = 'center';
        ctx.fillText(`No OES data for ${pm.name} yet — run a lot or "1 wafer"`, (L + R) / 2, (T + B) / 2);
    }

    drawSpectrum(ctx, v, r, w - specW - 4, T, specW, B - T);
}

function drawSpectrum(ctx, v, r, x0, y0, sw, sh) {
    ctx.fillStyle = '#070b12';
    ctx.fillRect(x0, y0, sw, sh + 12);
    ctx.strokeStyle = '#1f2c42';
    ctx.strokeRect(x0, y0, sw, sh + 12);
    const wl0 = 250, wl1 = 850;
    const X = wl => x0 + 6 + (wl - wl0) / (wl1 - wl0) * (sw - 12);
    for (let wl = 380; wl <= 780; wl += 4) {
        ctx.fillStyle = wlColor(wl, 0.6);
        ctx.fillRect(X(wl), y0 + sh + 2, X(wl + 4) - X(wl) + 0.5, 4);
    }
    ctx.fillStyle = '#5d6f8c';
    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('live spectrum', x0 + 5, y0 + 11);
    ctx.textAlign = 'center';
    for (const wl of [300, 500, 700]) ctx.fillText(wl, X(wl), y0 + sh + 12 + 0);

    if (!v || !v.plasma || !v.model || !v.sp || v.r !== r) return;
    const dens = v.model.nW / 0.55;
    const flow = Object.values(v.sp.gases).reduce((a, b) => a + b, 0) || 1;
    const prodF = clamp(((v.oesV || 0) - 14 * dens) / 80, 0, 1.5);
    for (const ln of r.lines) {
        let k = ln.src === 'prod' ? prodF : (v.sp.gases[ln.src] || 0) / flow * 2;
        const inten = clamp(ln.k * dens * k, 0, 1.2);
        if (inten <= 0.01) continue;
        const x = X(ln.wl), top = y0 + sh - inten * (sh - 24);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, top, 0, y0 + sh);
        g.addColorStop(0, wlColor(ln.wl, 0.95));
        g.addColorStop(1, wlColor(ln.wl, 0.15));
        ctx.fillStyle = g;
        ctx.shadowColor = wlColor(ln.wl);
        ctx.shadowBlur = 8;
        ctx.fillRect(x - 1.5, top, 3, y0 + sh - top);
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'source-over';
        const mon = ln.wl === r.epd.wl;
        ctx.fillStyle = mon ? '#fff' : '#9fb0c9';
        ctx.fillText(mon ? `▼${ln.sp}` : ln.sp, x, top - 3);
    }
}

/* =====================================================================
   10. Faults & alarms UI
   ===================================================================== */
const FAULT_TOPIC = {
    MW_REFL: 'waveguide', IGN_FAIL: 'ecr', COIL_TRIP: 'coils', PRESS_TOL: 'pump', MFC_DEV: 'gas',
    HE_LEAK: 'he', TEMP_HIGH: 'he', EPD_TIMEOUT: 'oes', ROBOT_ERR: 'tm', LL_PUMP: 'll',
};

function buildFaultUI() {
    const sel = $('#faultSel');
    sel.innerHTML = '';
    for (const k in FAULTS) {
        if (FAULTS[k].natural) continue;
        const o = document.createElement('option');
        o.value = k;
        o.textContent = `${FAULTS[k].code} ${FAULTS[k].title}`;
        sel.appendChild(o);
    }
    sel.addEventListener('change', fillFaultTargets);
    fillFaultTargets();
    $('#btnInject').addEventListener('click', injectFault);
}

function fillFaultTargets() {
    const f = FAULTS[$('#faultSel').value];
    const tgt = $('#faultTarget');
    const names = f.target === 'pm' ? [1, 2, 3, 4, 5, 6].map(i => 'PM' + i) : f.target === 'robot' ? Object.keys(robots) : ['LL-A', 'LL-B'];
    tgt.innerHTML = names.map(n => `<option>${n}</option>`).join('');
    if (f.target === 'pm') tgt.value = 'PM' + SIM.selPM;
}

function injectFault() {
    const key = $('#faultSel').value, name = $('#faultTarget').value, f = FAULTS[key];
    if (f.target === 'pm') pms[+name.slice(2)].armed.add(key);
    else if (f.target === 'robot') robots[name].armed = true;
    else stations[name].fault = true;
    log(`Fault armed: ${f.code} ${f.title} on ${name}`, 'warn');
    renderArmed();
}

function renderArmed() {
    const chips = [];
    for (let i = 1; i <= 6; i++) for (const k of pms[i].armed) chips.push([`PM${i}`, k]);
    for (const n in robots) if (robots[n].armed) chips.push([n, 'ROBOT_ERR']);
    for (const ll of LLS()) if (ll.fault && !ll.alarm) chips.push([ll.name, 'LL_PUMP']);
    const html = chips.map(([n, k]) =>
        `<span class="chip" title="Armed — triggers at the relevant point of the sequence">⚑ ${n}: ${FAULTS[k].code}<button data-disarm="${n}|${k}" title="Disarm">×</button></span>`
    ).join('');
    const box = $('#armedList');
    if (box.innerHTML !== html) box.innerHTML = html;
}

function disarm(n, k) {
    if (n.startsWith('PM')) pms[+n.slice(2)].armed.delete(k);
    else if (robots[n]) robots[n].armed = false;
    else stations[n].fault = false;
    renderArmed();
}

function renderAlarms() {
    const box = $('#alarmList');
    if (!box) return;
    box.innerHTML = SIM.alarms.map(a => {
        const f = FAULTS[a.key];
        return `<div class="alarm">
      <div class="hd"><span><span class="code">${a.code}</span> ${escapeHtml(f.title)}</span><span class="mono">${fmtClock(a.t)}</span></div>
      <div class="d">${escapeHtml(a.detail)}</div>
      <div class="ca"><b>Cause:</b> ${escapeHtml(f.cause)}</div>
      <div class="ca"><b>Action:</b> ${escapeHtml(f.action)}</div>
      <div class="row"><button class="btn small primary" data-recover="${a.id}">Recover</button>
      <button class="btn small" data-explain="${a.key}">Explain</button></div></div>`;
    }).join('');
}

/* =====================================================================
   11. Explainer & guided tour
   ===================================================================== */
function showTopic(id) {
    const tp = TOPICS[id];
    if (!tp) return;
    $('#explainTitle').textContent = tp.t;
    $('#explainText').innerHTML = tp.h;
}

function showFaultTopic(key) {
    const f = FAULTS[key];
    $('#explainTitle').textContent = `${f.code} — ${f.title}`;
    $('#explainText').innerHTML = `<p><b>What happened:</b> ${escapeHtml(f.cause)}</p>
<p><b>Recommended action:</b> ${escapeHtml(f.action)}</p>
<p>When resolved, press <b>Recover</b> on the alarm card. A wafer in an aborted chamber is flagged red and returned to its FOUP slot for disposition.</p>
<p>Background: <a href="#" data-topic="${FAULT_TOPIC[key]}">${TOPICS[FAULT_TOPIC[key]].t}</a></p>`;
}

const TOUR = [
    { topic: 'overview' },
    { topic: 'lp', hl: '#panel-platform' },
    { topic: 'efem', hl: '#panel-platform' },
    { topic: 'll', hl: '#panel-platform' },
    { topic: 'tm', hl: '#panel-platform' },
    { topic: 'pm', hl: '#panel-chamber', act: () => selectPM(1) },
    { topic: 'magnetron', hl: '#panel-chamber', hot: 'magnetron' },
    { topic: 'coils', hl: '#panel-chamber', hot: 'coils' },
    { topic: 'ecr', hl: '#panel-chamber', hot: 'ecr' },
    { topic: 'bfield', hl: '#panel-chamber', hot: 'bfield' },
    { topic: 'ions', hl: '#panel-chamber', hot: 'ions' },
    { topic: 'sheath', hl: '#panel-chamber', hot: 'sheath' },
    { topic: 'he', hl: '#panel-chamber', hot: 'esc' },
    { topic: 'tour_run', hl: '#panel-recipe', act: () => { selectPM(1); setSpeed(5); if (!pms[1].assigned && pms[1].state === 'idle') runSingle(1); } },
    { topic: 'oes', hl: '#panel-oes', hot: 'oes' },
    { topic: 'tour_knobs', hl: '#panel-controls' },
    { topic: 'tour_faults', hl: '#panel-alarms' },
    { topic: 'tour_end' },
];

function tourGo(i) {
    SIM.tour = clamp(i, 0, TOUR.length - 1);
    const s = TOUR[SIM.tour];
    document.querySelectorAll('.panel.tour-hl').forEach(p => p.classList.remove('tour-hl'));
    if (s.hl) $(s.hl).classList.add('tour-hl');
    CH.tourHot = s.hot || null;
    showTopic(s.topic);
    if (s.act) s.act();
    $('#tourNav').hidden = false;
    $('#tourStep').textContent = `Tour ${SIM.tour + 1} / ${TOUR.length}`;
    $('#tourPrev').disabled = SIM.tour === 0;
    $('#tourNext').textContent = SIM.tour === TOUR.length - 1 ? 'Finish' : 'Next ▶';
}

function tourExit() {
    SIM.tour = -1;
    CH.tourHot = null;
    document.querySelectorAll('.panel.tour-hl').forEach(p => p.classList.remove('tour-hl'));
    $('#tourNav').hidden = true;
}

/* =====================================================================
   12. Recipe CSV import / export
   ===================================================================== */
const STEP_TYPE_ALIASES = {
    base: 'base', basepressure: 'base', basepressurecheck: 'base',
    stab: 'stab', stabilize: 'stab', stabilise: 'stab', gasstabilize: 'stab',
    ignite: 'ignite', ignition: 'ignite', strike: 'ignite',
    bt: 'bt', breakthrough: 'bt',
    me: 'me', main: 'me', mainetch: 'me',
    oe: 'oe', overetch: 'oe',
    purge: 'purge', plasmaoff: 'purge',
    dechuck: 'dechuck', lift: 'dechuck',
    tp: 'tp', plasma: 'tp', timedplasma: 'tp', ash: 'tp',
};
const STEP_DEFAULT_NAMES = {
    base: 'Base pressure check', stab: 'Gas stabilize', ignite: 'Plasma ignite / tune', bt: 'Breakthrough',
    me: 'Main etch (EPD)', oe: 'Over-etch', purge: 'Plasma off / purge', dechuck: 'ESC dechuck / lift', tp: 'Plasma step',
};
const normKey = s => String(s ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
let csvCount = 0;

// Material constants for chemistries that have no built-in recipe
const MATERIAL_TEMPLATES = {
    sin: {
        // measured on 0275 KIWI: ~570 Å pre, ~440 Å post, ~326 Å/min
        film: { name: 'SiN', thick: 57, eth: 30, color: '#c8b27a' },
        under: { name: 'Si (recess)', thick: 3, eth: 70, color: '#8fa0b5' },
        nominal: { er: 32.6, sel: 15 },
        kChem: 0.05,
        hw: { coils: [27, 20, 4], he: 2000 },
        epd: { species: 'CN', wl: 387, drop: 0.35, maxTime: 120 },
        glow: [190, 150, 255],
        lines: [
            { wl: 387, sp: 'CN', k: 1.0, src: 'prod' },
            { wl: 337, sp: 'N₂', k: 0.4, src: 'prod' },
            { wl: 656, sp: 'Hα', k: 0.5, src: 'CH3F' },
            { wl: 777, sp: 'O', k: 0.6, src: 'O2' },
            { wl: 750, sp: 'Ar', k: 0.9, src: 'Ar' },
            { wl: 811, sp: 'Ar', k: 0.7, src: 'Ar' },
        ],
    },
};
const TEMPLATE_KEYS = ['poly', 'al', 'ox', 'sin'];
const getTemplate = k => RECIPE_DEFAULTS[k] || MATERIAL_TEMPLATES[k];

function parseCsvText(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0];
    // Excel in comma-decimal locales saves with ';'
    const delim = first.includes(';') && !first.includes(',') ? ';' : ',';
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
            } else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === delim) { row.push(cell.trim()); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell.trim()); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
    return { rows: rows.filter(r => r.some(c => c !== '')), decimalComma: delim === ';' };
}

function guessTemplate(me) {
    const g = me.gases;
    if (g.CH3F) return 'sin';
    if (g.BCl3) return 'al';
    if ((g.CF4 || g.CHF3) && !g.Cl2 && !g.HBr) return 'ox';
    return 'poly';
}

const csvError = (details, warnings) => Object.assign(new Error('bad'), { details, warnings });

// set: optional overrides { name, template, film, under, nominal, coils, he, epd }; missing values come from the template
function buildRecipe(steps, set, warnings, notes) {
    const me = steps.find(s => s.type === 'me');
    const tplKey = TEMPLATE_KEYS.includes(set.template) ? set.template : guessTemplate(me);
    const tpl = getTemplate(tplKey);
    if (!set.film) notes.push(`Film not given — assumed ${tpl.film.thick} nm ${tpl.film.name} on ${tpl.under.name} (${tplKey} template).`);
    const epd = { ...tpl.epd, ...set.epd };
    const gasLines = [];
    for (const k of TEMPLATE_KEYS) {
        for (const ln of getTemplate(k).lines) {
            if (ln.src !== 'prod' && !gasLines.some(x => x.wl === ln.wl && x.src === ln.src)) gasLines.push(ln);
        }
    }
    const recipe = {
        name: String(set.name).slice(0, 60),
        chem: Object.keys(me.gases).join(' / '),
        fromCsv: true,
        template: tplKey,
        film: { ...tpl.film, ...set.film },
        under: { ...tpl.under, ...set.under },
        nominal: { ...tpl.nominal, ...set.nominal },
        kChem: tpl.kChem,
        hw: { coils: set.coils || [...tpl.hw.coils], he: set.he ?? tpl.hw.he },
        epd: { ...epd, species: String(epd.species).slice(0, 12) },
        glow: tpl.glow,
        lines: [...gasLines, ...tpl.lines.filter(l => l.src === 'prod' && l.wl !== epd.wl), { wl: epd.wl, sp: String(epd.species).slice(0, 12), k: 1, src: 'prod' }],
        steps,
    };
    const raw = plasmaRaw(recipe, me, recipe.hw.coils, recipe.hw.he);
    if (!raw.ok) throw csvError([`Main-etch settings give no plasma: ${modelReason(raw, me)}.`], warnings);
    return recipe;
}

// Equipment export: one row per parameter (No, Item, Unit), one column per recipe step
function parseToolCsv(rows, num, fileName) {
    const warnings = [], notes = [], errors = [];
    const head = rows[0];
    const stepCols = [];
    for (let k = 3; k < head.length; k++) if (head[k]) stepCols.push(k);
    if (!stepCols.length) throw csvError(['No step columns found after No, Item, Unit.'], warnings);

    const items = {}, gasRows = [];
    for (const r of rows.slice(1)) {
        const item = r[1] || '';
        if (!item) continue;
        const gm = item.match(/^gas\s*\d+.*flow\s*rate\s*\(([^)]+)\)/i);
        if (gm) gasRows.push({ r, gas: gm[1].trim() });
        else items[item.toLowerCase().replace(/[^a-z0-9]/g, '')] = { r, unit: (r[2] || '').trim(), label: item };
    }
    const val = (key, k) => {
        const it = items[key];
        if (!it) return undefined;
        const v = num(it.r[k]);
        return v === undefined || Number.isNaN(v) ? undefined : v;
    };
    const lim = (v, lo, hi, label) => {
        if (v < lo || v > hi) { warnings.push(`${label} ${v} clamped to ${lo}–${hi}.`); return clamp(v, lo, hi); }
        return v;
    };

    const unknownGases = new Set();
    const fileSteps = stepCols.map(k => {
        const name = head[k].slice(0, 30);
        const time = val('steptime', k) ?? 0;
        const power = val('sourcepower', k) ?? 0;
        const gases = {};
        for (const { r, gas } of gasRows) {
            const f = num(r[k]);
            if (!(f > 0)) continue;
            const g = Object.keys(GASES).find(x => x.toLowerCase() === gas.toLowerCase());
            if (g) gases[g] = lim((gases[g] || 0) + f, 0, 500, `${name}: ${g} flow`);
            else unknownGases.add(gas);
        }
        const s = { name, time, power, gases, plasma: power > 0 && Object.keys(gases).length > 0, epdRecipe: val('epdrecipe', k) ?? 0 };

        let p = val('processpressure', k);
        if (s.plasma && (val('pressurecontrolmode', k) === 0 || !(p > 0))) {
            p = 1.0;
            notes.push(`${name}: fixed valve opening (V.V. ${val('vvopen', k) ?? '?'} %) — pressure not in file, assumed 1.0 Pa.`);
        }
        s.p = p;

        const bi = val('wbiasinnerpower', k) ?? 0, bo = val('wbiasouterpower', k) ?? 0;
        let bias = bi;
        if (bi !== bo) {
            bias = (bi + bo) / 2;
            warnings.push(`${name}: inner/outer bias differ (${bi} / ${bo} W) — using their mean ${bias} W.`);
        }
        const tmF = val('tmfrequency', k) ?? 0, tmD = val('tmduty', k) ?? 0;
        if (bias > 0 && tmF > 0 && tmD > 0) {
            s.note = `${bias} W × ${tmD} % TM duty @ ${tmF} Hz`;
            notes.push(`${name}: bias ${s.note} → ${+(bias * tmD / 100).toFixed(1)} W time-averaged.`);
            bias = bias * tmD / 100;
        }
        s.bias = bias;
        s.coils = [val('coilucurrent', k) ?? 0, val('coilmcurrent', k) ?? 0, val('coillcurrent', k) ?? 0]
            .map((a, i) => lim(a, 0, COIL_MAX_A, `${name}: ${COILS[i].name} coil`));
        const bp = val('backsidepressure', k);
        if (bp !== undefined) s.he = /kpa/i.test(items.backsidepressure.unit) ? bp * 1000 : bp;
        s.deadTime = val('epddeadtime', k);
        if ((val('overprocratio', k) ?? 0) > 0 || (val('overproctime', k) ?? 0) > 0) warnings.push(`${name}: over-process settings are not modelled.`);
        return s;
    });
    for (const g of unknownGases) warnings.push(`Gas "${g}" not modelled — its flow is ignored.`);

    const plasmaSteps = fileSteps.filter(s => s.plasma);
    if (!plasmaSteps.length) throw csvError(['No plasma step found (needs Source Power > 0 and a gas flow).'], warnings);
    let main = fileSteps.find(s => s.plasma && s.epdRecipe > 0);
    if (!main) {
        main = plasmaSteps.reduce((a, b) => (b.time > a.time ? b : a));
        warnings.push(`No step uses EPD — treating the longest plasma step "${main.name}" as the main etch.`);
    } else if (fileSteps.filter(s => s.plasma && s.epdRecipe > 0).length > 1) {
        warnings.push(`Several steps use EPD — "${main.name}" is treated as the main etch, others as timed plasma steps.`);
    }

    const steps = [
        { type: 'base', name: 'Base pressure check (implicit)', dur: 3 },
        { type: 'stab', name: 'Gas stabilize (implicit)', dur: 5 },
        { type: 'ignite', name: 'Plasma ignite / tune (implicit)', dur: 2 },
    ];
    for (const s of fileSteps) {
        if (!(s.time > 0)) { warnings.push(`${s.name}: step time is 0 — skipped.`); continue; }
        const dur = lim(s.time, 0.5, 600, `${s.name}: step time`);
        if (!s.plasma) { steps.push({ type: 'purge', name: s.name, dur }); continue; }
        const st = {
            type: s === main ? 'me' : 'tp', name: s.name, dur,
            mw: lim(s.power, 0, 2000, `${s.name}: source power`), bias: lim(s.bias, 0, 500, `${s.name}: bias`),
            p: lim(s.p, 0.05, 3, `${s.name}: pressure`), gases: s.gases,
        };
        if (s.note) st.note = s.note;
        if (s !== main && s.coils.join() !== main.coils.join()) st.coils = s.coils;
        steps.push(st);
    }
    steps.push({ type: 'purge', name: 'Plasma off / purge (implicit)', dur: 4 });
    if (errors.length) throw csvError(errors, warnings);

    if (plasmaSteps.some(s => s.he !== undefined && s.he !== main.he)) warnings.push(`He backside differs between steps — using ${main.name}'s ${main.he} Pa for all.`);
    notes.push(`${main.name} is the main etch: it always runs its ${main.time} s; EPD only monitors (dead time ${main.deadTime ?? 0} s).`);
    notes.push('Not modelled: ESC voltages, stage temperature zones & heater powers, Vpp checks, step-change mode, EPD recipe contents.');

    const recipe = buildRecipe(steps, {
        name: fileName.replace(/\.csv$/i, ''),
        coils: main.coils,
        he: main.he !== undefined ? clamp(main.he, 0, 2000) : undefined,
        epd: { maxTime: Math.max(10, main.time), ...(main.deadTime !== undefined ? { deadTime: main.deadTime } : {}) },
    }, warnings, notes);
    return { recipe, warnings, notes };
}

function parseRecipeCsv(text, fileName) {
    const { rows, decimalComma } = parseCsvText(text);
    const errors = [], warnings = [], notes = [];
    const num = v => {
        if (v === undefined || v === '') return undefined;
        const n = Number(decimalComma ? v.replace(',', '.') : v);
        return Number.isFinite(n) ? n : NaN;
    };
    if (rows.length && normKey(rows[0][0]) === 'no' && normKey(rows[0][1]) === 'item') return parseToolCsv(rows, num, fileName);

    const meta = {};
    let h = 0;
    for (; h < rows.length && normKey(rows[h][0]) !== 'step'; h++) meta[normKey(rows[h][0])] = rows[h].slice(1);
    if (h >= rows.length) throw Object.assign(new Error('bad'), { details: ['No step table found — expected a header row whose first cell is "Step".'], warnings });

    const head = rows[h].map(normKey);
    const col = (...names) => head.findIndex(x => names.includes(x));
    const c = {
        name: col('name', 'stepname'), type: col('type', 'steptype'), time: col('time', 'duration', 'steptime'),
        over: col('overetch', 'overetchpct', 'oe'), mw: col('uw', 'mw', 'microwave', 'microwavepower', 'uwpower'),
        bias: col('bias', 'rfbias', 'biaspower'), p: col('pressure', 'p'),
        cu: col('coilu', 'coilupper'), cm: col('coilm', 'coilmiddle'), cl: col('coill', 'coillower'),
    };
    if (c.type < 0) errors.push('Step table needs a "Type" column.');
    const gasCols = [];
    head.forEach((x, k) => {
        if (k === 0 || !x || Object.values(c).includes(k)) return;
        const g = Object.keys(GASES).find(name => normKey(name) === x);
        if (g) gasCols.push([k, g]);
        else warnings.push(`Column "${rows[h][k]}" not recognised — ignored (known gases: ${Object.keys(GASES).join(', ')}).`);
    });

    const steps = [];
    for (const r of rows.slice(h + 1)) {
        const n = r[0] || String(steps.length + 1);
        const type = STEP_TYPE_ALIASES[normKey(r[c.type])];
        if (!type) {
            errors.push(`Step ${n}: unknown type "${r[c.type] ?? ''}" (use BASE, STAB, IGNITE, BT, ME, OE, PLASMA, PURGE, DECHUCK).`);
            continue;
        }
        const s = { type, name: (c.name >= 0 && r[c.name]) || STEP_DEFAULT_NAMES[type] };
        const get = (k, label, lo, hi, required) => {
            const v = k >= 0 ? num(r[k]) : undefined;
            if (v === undefined) {
                if (required) errors.push(`Step ${n} (${s.name}): missing ${label}.`);
                return undefined;
            }
            if (Number.isNaN(v)) { errors.push(`Step ${n} (${s.name}): ${label} "${r[k]}" is not a number.`); return undefined; }
            if (v < lo || v > hi) { warnings.push(`Step ${n}: ${label} ${v} clamped to ${lo}–${hi}.`); return clamp(v, lo, hi); }
            return v;
        };
        if (PLASMA_STEPS.includes(type)) {
            s.mw = get(c.mw, 'µW power (W)', 0, 2000, true);
            s.bias = get(c.bias, 'bias (W)', 0, 500, true);
            s.p = get(c.p, 'pressure (Pa)', 0.05, 3, true);
            s.gases = {};
            for (const [k, g] of gasCols) {
                const f = get(k, `${g} flow (sccm)`, 0, 500, false);
                if (f) s.gases[g] = f;
            }
            if (!Object.keys(s.gases).length) errors.push(`Step ${n} (${s.name}): plasma step has no gas flow.`);
            const raw = [c.cu, c.cm, c.cl].map((k, i) => get(k, `${COILS[i].name} coil (A)`, 0, COIL_MAX_A, false));
            if (raw.some(a => a !== undefined)) s._coilRaw = raw;
        }
        if (type === 'oe') s.overPct = get(c.over, 'over-etch (%)', 0, 300, true);
        else if (type === 'me') {
            const d = get(c.time, 'time (s)', 0.5, 600, false);
            if (d !== undefined) s.dur = d;
        } else s.dur = get(c.time, 'time (s)', 0.5, 600, true);
        steps.push(s);
    }
    const meCount = steps.filter(s => s.type === 'me').length;
    if (meCount !== 1) errors.push(`Recipe needs exactly one ME (main etch) step; found ${meCount}.`);
    if (errors.length) throw csvError(errors, warnings);

    const known = ['recipe', 'name', 'template', 'film', 'underlayer', 'nominaler', 'nominalselectivity', 'coilupper', 'coilmiddle',
        'coillower', 'hebackside', 'epdspecies', 'epdwavelength', 'epddrop', 'epdmaxtime', 'epddeadtime'];
    for (const k in meta) if (k && !known.includes(k)) warnings.push(`Setting "${k}" not recognised — ignored.`);
    const m = k => meta[k] || [];
    const mnum = (k, idx, lo, hi, label) => {
        const raw = m(k)[idx], v = num(raw);
        if (v === undefined) return undefined;
        if (Number.isNaN(v)) { warnings.push(`${label} "${raw}" is not a number — using the template value.`); return undefined; }
        if (v < lo || v > hi) warnings.push(`${label} ${v} clamped to ${lo}–${hi}.`);
        return clamp(v, lo, hi);
    };
    const strip = o => {
        for (const k in o) if (o[k] === undefined) delete o[k];
        return Object.keys(o).length ? o : undefined;
    };

    const me = steps.find(s => s.type === 'me');
    const tplWanted = normKey(m('template')[0]);
    const tpl = getTemplate(TEMPLATE_KEYS.includes(tplWanted) ? tplWanted : guessTemplate(me));
    const coilVals = [mnum('coilupper', 0, 0, COIL_MAX_A, 'Coil upper'), mnum('coilmiddle', 0, 0, COIL_MAX_A, 'Coil middle'), mnum('coillower', 0, 0, COIL_MAX_A, 'Coil lower')];
    let hwCoils = coilVals.map((v, i) => v ?? tpl.hw.coils[i]);
    if (me._coilRaw) hwCoils = me._coilRaw.map((v, i) => v ?? hwCoils[i]);
    for (const s of steps) {
        if (s._coilRaw && s !== me) s.coils = s._coilRaw.map((v, i) => v ?? hwCoils[i]);
        delete s._coilRaw;
    }

    const set = {
        name: m('recipe')[0] || m('name')[0] || fileName.replace(/\.csv$/i, ''),
        template: TEMPLATE_KEYS.includes(tplWanted) ? tplWanted : undefined,
        film: m('film').length ? strip({ name: m('film')[0] ? m('film')[0].slice(0, 30) : undefined, thick: mnum('film', 1, 1, 5000, 'Film thickness') }) : undefined,
        under: m('underlayer').length ? strip({ name: m('underlayer')[0] ? m('underlayer')[0].slice(0, 30) : undefined, thick: mnum('underlayer', 1, 0.1, 5000, 'Underlayer thickness') }) : undefined,
        nominal: strip({ er: mnum('nominaler', 0, 1, 10000, 'Nominal ER'), sel: mnum('nominalselectivity', 0, 1, 999, 'Nominal selectivity') }),
        coils: hwCoils,
        he: mnum('hebackside', 0, 0, 2000, 'He backside'),
        epd: strip({
            species: m('epdspecies')[0] || undefined,
            wl: mnum('epdwavelength', 0, 200, 900, 'EPD wavelength'),
            drop: (v => v === undefined ? undefined : v / 100)(mnum('epddrop', 0, 5, 90, 'EPD drop')),
            maxTime: mnum('epdmaxtime', 0, 10, 900, 'EPD max time'),
            deadTime: mnum('epddeadtime', 0, 0, 120, 'EPD dead time'),
        }),
    };
    if (!m('film').length) delete set.film;
    if (me.dur) notes.push(`${me.name} has a Time, so it always runs ${me.dur} s and EPD only monitors.`);
    const recipe = buildRecipe(steps, set, warnings, notes);
    return { recipe, warnings, notes };
}

function addRecipe(recipe) {
    const key = 'csv' + (++csvCount);
    RECIPES[key] = recipe;
    RECIPE_DEFAULTS[key] = JSON.parse(JSON.stringify(recipe));
    calibrate(key);
    SIM.recipeKey = key;
    buildRecipeSelect();
    buildKnobs();
    updateMetrics();
    buildStepsTable(true);
    return key;
}

function loadRecipeFile(file) {
    if (file.size > 1e6) {
        log(`${file.name}: file too large for a recipe (>1 MB)`, 'err');
        return;
    }
    file.text().then(text => {
        const warnList = w => w.length ? `<p><b>Warnings:</b></p><ul>${w.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
        try {
            const { recipe, warnings, notes } = parseRecipeCsv(text, file.name);
            addRecipe(recipe);
            const me = meStep(recipe);
            const m = plasmaModel(recipe, me, recipe.hw.coils, recipe.hw.he);
            log(`Recipe "${recipe.name}" loaded from ${file.name} (${recipe.steps.length} steps${warnings.length ? ', ' + warnings.length + ' warning(s)' : ''})`, warnings.length ? 'warn' : 'ok');
            const removed = me.dur ? m.er * me.dur / 60 : null;
            $('#explainTitle').textContent = `Recipe loaded: ${recipe.name}`;
            $('#explainText').innerHTML =
                `<p>${recipe.steps.length} steps · ${escapeHtml(recipe.film.thick + ' nm ' + recipe.film.name)} on ${escapeHtml(recipe.under.name)} · ` +
                `material constants from the <b>${recipe.template}</b> template.</p>` +
                `<p>Main etch <b>${escapeHtml(me.name)}</b>: ${me.mw} W µW, ${me.bias} W bias, ${me.p} Pa, ${escapeHtml(Object.entries(me.gases).map(([g, f]) => `${g} ${f}`).join(' · '))}. ` +
                `ECR zone ${m.zres.toFixed(0)} mm, predicted ${m.er.toFixed(1)} nm/min` +
                (removed !== null ? ` → removes ${removed.toFixed(1)} nm in ${me.dur} s, leaving ${Math.max(0, recipe.film.thick - removed).toFixed(1)} nm.</p>` : '.</p>') +
                (notes.length ? `<p><b>How the file was interpreted:</b></p><ul>${notes.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '') +
                `<p>It is now selected. Use <b>Load &amp; run lot</b> to process wafers with it.</p>` +
                warnList(warnings) + '<p><a href="#" data-topic="csv_format">Recipe CSV format</a></p>';
        } catch (err) {
            const details = err.details || [String(err.message || err)];
            log(`${file.name}: recipe not loaded (${details.length} error(s))`, 'err');
            $('#explainTitle').textContent = `Recipe not loaded: ${file.name}`;
            $('#explainText').innerHTML = `<p><b>Errors:</b></p><ul>${details.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` +
                warnList(err.warnings || []) + '<p><a href="#" data-topic="csv_format">Recipe CSV format</a></p>';
        }
    });
}

function recipeToCsv(key) {
    const r = RECIPES[key], me = meStep(r);
    const m = plasmaModel(r, me, r.hw.coils, r.hw.he);
    const gasNames = Object.keys(GASES).filter(g => r.steps.some(s => s.gases && s.gases[g]));
    const stepCoils = r.steps.some(s => s.coils);
    const q = v => /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const rows = [
        ['Recipe', r.name], ['Template', r.template || key],
        ['Film', r.film.name, r.film.thick], ['Underlayer', r.under.name, r.under.thick],
        // nominal = current prediction, so a re-import reproduces the same results
        ['Nominal ER (nm/min)', +m.er.toFixed(1)], ['Nominal selectivity', Math.round(m.sel)],
        ['Coil upper (A)', r.hw.coils[0]], ['Coil middle (A)', r.hw.coils[1]], ['Coil lower (A)', r.hw.coils[2]],
        ['He backside (Pa)', r.hw.he],
        ['EPD species', r.epd.species], ['EPD wavelength (nm)', r.epd.wl],
        ['EPD drop (%)', +(r.epd.drop * 100).toFixed(1)], ['EPD max time (s)', r.epd.maxTime],
        ...(r.epd.deadTime !== undefined ? [['EPD dead time (s)', r.epd.deadTime]] : []),
        [],
        ['Step', 'Name', 'Type', 'Time (s)', 'Over-etch (%)', 'uW (W)', 'Bias (W)', 'Pressure (Pa)', ...gasNames,
            ...(stepCoils ? ['Coil U (A)', 'Coil M (A)', 'Coil L (A)'] : [])],
        ...r.steps.map((s, i) => {
            const p = PLASMA_STEPS.includes(s.type);
            const sc = p ? (s.coils || r.hw.coils) : null;
            return [i + 1, s.name, s.type === 'tp' ? 'PLASMA' : s.type.toUpperCase(), s.dur ?? '', s.overPct ?? '', p ? s.mw : '', p ? s.bias : '', p ? s.p : '',
            ...gasNames.map(g => p ? (s.gases[g] ?? '') : ''),
            ...(stepCoils ? (sc ? sc : ['', '', '']) : [])];
        }),
    ];
    return rows.map(row => row.map(q).join(',')).join('\r\n') + '\r\n';
}

function exportRecipe() {
    const r = RECIPES[SIM.recipeKey];
    const blob = new Blob([recipeToCsv(SIM.recipeKey)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = r.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`Recipe "${r.name}" exported to ${a.download}`, 'ok');
}

/* =====================================================================
   13. App wiring & main loop
   ===================================================================== */
function selectPM(i) {
    SIM.selPM = i;
    $('#chamberTitle').textContent = 'PM' + i;
    $('#singlePM').textContent = 'PM' + i;
    if (FAULTS[$('#faultSel').value].target === 'pm') $('#faultTarget').value = 'PM' + i;
    CH.ions.length = 0;
    buildStepsTable(true);
}

function setSpeed(s) {
    SIM.speed = s;
    document.querySelectorAll('#speedSeg button').forEach(b => b.classList.toggle('on', +b.dataset.speed === s));
}

function setRunning(on) {
    SIM.running = on;
    $('#btnRun').textContent = on ? '❚❚ Pause' : '▶ Run';
}

function resetAll() {
    for (const w of SIM.wafers) if (w.el) w.el.remove();
    Object.assign(SIM, { t: 0, wafers: [], queue: [], lots: 0, wafersOut: 0, firstStart: null, alarms: [], pairNext: [1, 3, 5] });
    initTool();
    buildPlatform();
    CH.ions.length = 0;
    CH.rads.length = 0;
    renderAlarms();
    renderArmed();
    fillFaultTargets();
    buildStepsTable(true);
    $('#eventLog').innerHTML = '';
    log('Tool reset — all modules idle, load locks at atmosphere', 'ok');
}

function updateHeader() {
    let state = 'IDLE';
    if (SIM.alarms.length) state = 'ALARM';
    else if (!SIM.running) state = 'PAUSED';
    else if (SIM.wafers.some(w => w.state !== 'returned')) state = 'RUNNING';
    const el = $('#toolState');
    el.textContent = state;
    el.className = 'state ' + state.toLowerCase();
    const lamps = $('#tower').children;
    lamps[0].className = 'lamp red' + (state === 'ALARM' ? ' on blink' : '');
    lamps[1].className = 'lamp amber' + (state === 'IDLE' || state === 'PAUSED' ? ' on' : '');
    lamps[2].className = 'lamp green' + (state === 'RUNNING' ? ' on' : '');
    $('#simClock').textContent = fmtClock(SIM.t);
    $('#wafersOut').textContent = SIM.wafersOut;
    const hrs = SIM.firstStart !== null ? (SIM.t - SIM.firstStart) / 3600 : 0;
    $('#wph').textContent = SIM.wafersOut > 0 && hrs > 0 ? `${(SIM.wafersOut / hrs).toFixed(1)} WPH` : '— WPH';
}

function wireUI() {
    $('#btnRun').addEventListener('click', () => setRunning(!SIM.running));
    $('#btnReset').addEventListener('click', resetAll);
    document.querySelectorAll('#speedSeg button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('#btnTour').addEventListener('click', () => tourGo(0));
    $('#tourPrev').addEventListener('click', () => tourGo(SIM.tour - 1));
    $('#tourNext').addEventListener('click', () => SIM.tour >= TOUR.length - 1 ? tourExit() : tourGo(SIM.tour + 1));
    $('#tourExit').addEventListener('click', tourExit);
    $('#chkFollow').addEventListener('change', e => { SIM.follow = e.target.checked; });
    $('#chkLabels').addEventListener('change', e => { CH.labels = e.target.checked; });
    $('#chkField').addEventListener('change', e => { CH.field = e.target.checked; });
    $('#chkPreview').addEventListener('change', e => { CH.preview = e.target.checked; });

    $('#btnLot').addEventListener('click', () => {
        const n = clamp(parseInt($('#lotCount').value, 10) || 1, 1, 25);
        const pv = $('#lotPair').value;
        if (loadLot(+$('#lotLP').value, n, SIM.recipeKey, null, pv === 'auto' ? null : +pv)) setRunning(true);
    });
    $('#btnSingle').addEventListener('click', () => { if (runSingle(SIM.selPM)) setRunning(true); });

    $('#recipeSel').addEventListener('change', e => {
        SIM.recipeKey = e.target.value;
        buildKnobs();
        updateMetrics();
        buildStepsTable(true);
    });
    $('#btnDefaults').addEventListener('click', () => {
        const d = JSON.parse(JSON.stringify(RECIPE_DEFAULTS[SIM.recipeKey]));
        const r = RECIPES[SIM.recipeKey];
        r.steps.forEach((s, i) => Object.assign(s, d.steps[i]));
        Object.assign(r.hw, d.hw);
        buildKnobs();
        updateMetrics();
        buildStepsTable(true);
    });
    $('#btnLoadCsv').addEventListener('click', () => $('#csvFile').click());
    $('#csvFile').addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) loadRecipeFile(f);
        e.target.value = '';
    });
    $('#btnExportCsv').addEventListener('click', exportRecipe);

    // delegated clicks for topic links, alarm buttons, chips
    document.addEventListener('click', e => {
        const t = e.target.closest('[data-topic],[data-recover],[data-explain],[data-disarm]');
        if (!t) return;
        if (t.dataset.recover) recoverAlarm(+t.dataset.recover);
        else if (t.dataset.explain) showFaultTopic(t.dataset.explain);
        else if (t.dataset.disarm) disarm(...t.dataset.disarm.split('|'));
        else if (t.dataset.topic) { e.preventDefault(); showTopic(t.dataset.topic); }
    });

    const tip = $('#tooltip');
    CH.cv.addEventListener('mousemove', e => {
        const id = chamberHit(e);
        CH.hover = id;
        CH.cv.style.cursor = id ? 'pointer' : 'default';
        if (!id) { tip.hidden = true; return; }
        const tp = TOPICS[id];
        const first = tp.h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=\.)\s/)[0];
        tip.innerHTML = `<b>${escapeHtml(tp.t)}</b>${escapeHtml(first)}<br><i>click for details</i>`;
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
    });
    CH.cv.addEventListener('mouseleave', () => { CH.hover = null; tip.hidden = true; });
    CH.cv.addEventListener('click', e => { const id = chamberHit(e); if (id) showTopic(id); });
}

let lastFrame = performance.now(), uiAcc = 0;
function frame(now) {
    const realDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (SIM.running) {
        let simDt = realDt * SIM.speed;
        while (simDt > 1e-6) {
            const h = Math.min(0.1, simDt);
            simStep(h);
            simDt -= h;
        }
    }
    renderPlatform();
    renderChamber(SIM.running ? realDt : 0);
    renderOES();
    uiAcc += realDt;
    if (uiAcc > 0.15) {
        uiAcc = 0;
        updateHeader();
        updateStepsHighlight();
        renderArmed();
    }
    requestAnimationFrame(frame);
}

function init() {
    CH.cv = $('#chamberCanvas');
    CH.ctx = CH.cv.getContext('2d');
    OES.cv = $('#oesCanvas');
    OES.ctx = OES.cv.getContext('2d');
    for (const k in RECIPES) calibrate(k);
    initTool();
    buildPlatform();
    buildRecipeSelect();
    buildKnobs();
    updateMetrics();
    buildStepsTable(true);
    buildFaultUI();
    wireUI();
    showTopic('overview');
    log('MME ECR etcher online — load a lot or start the guided tour', 'ok');
    requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', init);
