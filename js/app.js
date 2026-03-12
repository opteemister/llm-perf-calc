import { calcAll } from './calc.js';

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  screen: 'hardware-list',
  selectedHardwareId: null,
  selectedModelId: null,
  selectedVariantIdx: 0,      // model variant index (Screen 3b)
  selectedHwVariantIdx: 0,    // hardware variant index (Screen 2)
  selectedModelIdInHw: null,  // highlighted model in Screen 2
  hwPanelOpen: false,         // third panel visible in Screen 2
};

let hardware = [];
let models   = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function init() {
  [hardware, models] = await Promise.all([
    fetch('data/hardware.json').then(r => r.json()),
    fetch('data/models.json').then(r => r.json()),
  ]);
  render();
}

document.addEventListener('DOMContentLoaded', init);

// ── Navigation ────────────────────────────────────────────────────────────
export function navigate(screen, id) {
  state.screen = screen;
  if (screen === 'hardware-detail') {
    state.selectedHardwareId = id;
    state.selectedHwVariantIdx = 0;
    state.selectedModelIdInHw = null;
    state.hwPanelOpen = false;
  }
  if (screen === 'model-detail') {
    state.selectedModelId = id;
    state.selectedVariantIdx = defaultVariantIdx(models.find(m => m.id === id));
  }
  render();
}

window.app = { navigate };

// ── Render dispatcher ─────────────────────────────────────────────────────
function render() {
  updateSidebarActive();
  switch (state.screen) {
    case 'hardware-list':   renderHardwareList();   break;
    case 'hardware-detail': renderHardwareDetail(); break;
    case 'models-list':     renderModelsList();     break;
    case 'model-detail':    renderModelDetail();    break;
  }
}

function updateSidebarActive() {
  const hw = document.getElementById('nav-hardware');
  const mo = document.getElementById('nav-models');
  if (!hw || !mo) return;
  const onHw = state.screen === 'hardware-list' || state.screen === 'hardware-detail';
  hw.className = 'nav-item' + (onHw ? ' active' : '');
  mo.className = 'nav-item' + (!onHw ? ' active' : '');
}

function mount(html) {
  document.getElementById('app').innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function vendorBadgeClass(hw) {
  if (hw.type === 'apple_silicon') return 'apple';
  if (hw.type === 'nvidia_gpu')    return 'nvidia';
  return 'other';
}

function formatPrice(usd) {
  if (usd === null) return '—';
  return '$' + usd.toLocaleString('en-US');
}

function tpsClass(val) {
  if (val === null || val === undefined) return 'tps-dash';
  if (val === 'OOM') return 'tps-oom';
  if (val >= 20) return 'tps-green';
  if (val >= 5)  return 'tps-yellow';
  return 'tps-red';
}

function metricDisplay(val) {
  if (val === null || val === undefined) return '—';
  return val;
}

function ctxLabel(k) {
  if (k >= 1000) return Math.round(k / 1000) + 'M';
  return k + 'K';
}

function tierBadgeClass(tier) {
  if (tier === 'frontier') return 'frontier';
  if (tier === 'coding')   return 'coding';
  return 'average';
}

function tierBadgeLabel(tier) {
  if (tier === 'frontier') return 'Frontier';
  if (tier === 'coding')   return 'Coding';
  return 'Everyday';
}

// Returns variants array for hardware. For hardware without variants (flat spec), synthesises one.
function hwVariants(hw) {
  if (hw.variants && hw.variants.length) return hw.variants;
  return [{
    label: `${hw.vram_gb} GB`,
    vram_gb: hw.vram_gb,
    price_usd: hw.price_usd,
    tdp_w: hw.tdp_w,
    special_behavior: hw.special_behavior,
  }];
}

// Merges a hardware variant's fields into the base hw object for calculations and display.
function effectiveHw(hw, v) {
  return {
    ...hw,
    vram_gb: v.vram_gb,
    price_usd: v.price_usd,
    tdp_w: v.tdp_w ?? hw.tdp_w,
    special_behavior: v.special_behavior ?? hw.special_behavior,
  };
}

// Default model variant: Q4_K_M if it exists, else largest by bits_per_weight (tie-break by vram_gb)
function defaultVariantIdx(model) {
  if (!model) return 0;
  const idx = model.variants.findIndex(v => v.quant === 'Q4_K_M');
  if (idx >= 0) return idx;
  let bestIdx = 0;
  for (let i = 1; i < model.variants.length; i++) {
    const a = model.variants[bestIdx];
    const b = model.variants[i];
    if (b.bits_per_weight > a.bits_per_weight) bestIdx = i;
    else if (b.bits_per_weight === a.bits_per_weight && b.vram_gb > a.vram_gb) bestIdx = i;
  }
  return bestIdx;
}

// Best-fitting model variant for a given effective hardware (returns variant or null)
function bestVariant(effHw, model) {
  const fitting = model.variants.filter(v => v.vram_gb <= effHw.vram_gb);
  if (!fitting.length) return null;
  const q4km = fitting.find(v => v.quant === 'Q4_K_M');
  if (q4km) return q4km;
  return fitting.reduce((best, v) => {
    if (v.bits_per_weight !== best.bits_per_weight)
      return v.bits_per_weight > best.bits_per_weight ? v : best;
    return v.vram_gb > best.vram_gb ? v : best;
  });
}

// ── Screen 1: Hardware List ───────────────────────────────────────────────
function renderHardwareList() {
  const sorted = [...hardware].sort((a, b) => {
    const aMax = hwVariants(a).reduce((m, v) => Math.max(m, v.vram_gb), 0);
    const bMax = hwVariants(b).reduce((m, v) => Math.max(m, v.vram_gb), 0);
    if (bMax !== aMax) return bMax - aMax;
    return b.memory_bandwidth_gbps - a.memory_bandwidth_gbps;
  });

  const cards = sorted.map(hw => {
    const vars = hwVariants(hw);
    const vramDisplay = vars.length > 1
      ? vars.map(v => v.vram_gb).join(' / ') + ' GB'
      : `${vars[0].vram_gb} GB`;
    const priceDisplay = vars.length > 1
      ? `from ${formatPrice(vars[0].price_usd)}`
      : formatPrice(vars[0].price_usd);
    const tdpDisplay = vars[0].tdp_w ?? hw.tdp_w;

    return `
      <div class="hw-card" onclick="app.navigate('hardware-detail','${hw.id}')">
        <div class="vendor-badge ${vendorBadgeClass(hw)}">${hw.vendor}</div>
        <div class="hw-card-name">${hw.name}</div>
        <div class="hw-card-specs">
          <span>${vramDisplay}</span> · <span>${hw.memory_bandwidth_gbps} GB/s</span><br>
          <span>${priceDisplay}</span> · <span>${tdpDisplay ?? '—'} W</span>
        </div>
      </div>
    `;
  }).join('');

  mount(`
    <div class="page-title">Hardware</div>
    <div class="page-subtitle">Sorted by VRAM · click a card to see compatible models</div>
    <div class="card-grid">${cards}</div>
  `);
}

// ── Screen 2: Hardware Detail ─────────────────────────────────────────────
function renderHardwareDetail() {
  const hw = hardware.find(h => h.id === state.selectedHardwareId);
  if (!hw) { navigate('hardware-list'); return; }

  const vars = hwVariants(hw);
  const selVar = vars[state.selectedHwVariantIdx] ?? vars[0];
  const eff = effectiveHw(hw, selVar);

  // Spec rows using effective hw
  const specRowsHtml = [
    ['VRAM',      `${eff.vram_gb} GB`],
    ['Bandwidth', `${eff.memory_bandwidth_gbps} GB/s`],
    ['Compute',   eff.compute_tflops_fp16 !== null ? `${eff.compute_tflops_fp16} TFLOPS` : '—'],
    ['Price',     formatPrice(eff.price_usd)],
    ['TDP',       eff.tdp_w !== null ? `${eff.tdp_w} W` : '—'],
    ['PCIe',      eff.pcie_bandwidth_gbps !== null ? `${eff.pcie_bandwidth_gbps} GB/s` : '—'],
    ['Type',      eff.type],
    ['Framework', Array.isArray(eff.framework) ? eff.framework.join(', ') : (eff.framework ?? '—')],
  ].map(([k, v]) => `
    <div class="spec-row">
      <span class="spec-key">${k}</span>
      <span class="spec-val">${v}</span>
    </div>
  `).join('');

  // Variant selector — only shown when there are multiple variants
  const variantSelectorHtml = vars.length > 1 ? `
    <div class="variants-section-label">Variants</div>
    ${vars.map((v, i) => `
      <div class="variant-row ${i === state.selectedHwVariantIdx ? 'selected' : ''}"
           onclick="selectHardwareVariant(${i})">
        <span class="v-quant">${v.label}</span>
        <span class="v-vram">${formatPrice(v.price_usd)}</span>
      </div>
    `).join('')}
  ` : '';

  const notesHtml = (hw.notes && hw.notes.length) ? `
    <div class="notes-block">
      <div class="notes-label">⚠ Notes</div>
      <div class="notes-text">${hw.notes.map(n => `<p>${n}</p>`).join('')}</div>
    </div>
  ` : '';

  const specPanel = `
    <div class="spec-panel">
      <span class="back-link" onclick="app.navigate('hardware-list')">← Hardware</span>
      <div class="spec-panel-title">${hw.name}</div>
      ${specRowsHtml}
      ${variantSelectorHtml}
      ${notesHtml}
    </div>
  `;

  // Model list: evaluate against effective hw (selected variant)
  const evaluated = models.map(model => {
    const variant = bestVariant(eff, model);
    if (!variant) {
      const smallest = model.variants.reduce((a, b) => a.vram_gb <= b.vram_gb ? a : b);
      return { model, variant: smallest, calc: calcAll(eff, model, smallest), fits: false };
    }
    return { model, variant, calc: calcAll(eff, model, variant), fits: true };
  });

  const available = evaluated
    .filter(e => e.fits)
    .sort((a, b) => b.model.total_params_b - a.model.total_params_b);

  const oom = evaluated
    .filter(e => !e.fits)
    .sort((a, b) => b.model.total_params_b - a.model.total_params_b);

  function modelRowHtml({ model, variant, calc, fits }) {
    if (!fits) {
      return `
        <div class="model-row oom-row">
          <div class="model-row-left">
            <div class="model-row-name">${model.name}</div>
            <div class="model-row-meta">${model.total_params_b}B params · ${variant.quant} · needs ${variant.vram_gb} GB VRAM</div>
          </div>
          <div class="model-row-right" style="align-items:center">
            <span class="tps-badge tps-oom">OOM</span>
          </div>
        </div>
      `;
    }

    const tps      = metricDisplay(calc.tps);
    const tpsMax   = metricDisplay(calc.tps_max_ctx);
    const prefill  = metricDisplay(calc.prefill_tps);
    const loadTime = calc.load_time_s !== null ? `${calc.load_time_s}s` : '—';

    const isSelected = state.selectedModelIdInHw === model.id;
    const isPanelOpen = isSelected && state.hwPanelOpen;
    const panelIcon = `<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="0.6" y="0.6" width="10.8" height="10.8" rx="1.5"/><line x1="8" y1="0.6" x2="8" y2="11.4"/></svg>`;
    return `
      <div class="model-row${isSelected ? ' selected-in-hw' : ''}${isPanelOpen ? ' panel-open' : ''}" onclick="selectModelHighlight('${model.id}')">
        <div class="model-row-left">
          <div class="model-row-name">${model.name}<span class="tps-dot ${tpsClass(calc.tps)}"></span></div>
          <div class="model-row-meta">
            ${model.total_params_b}B params · ${variant.quant} · ${variant.vram_gb} GB VRAM · disk ${variant.disk_gb} GB · ${ctxLabel(model.context_length_k)} ctx
          </div>
        </div>
        <div class="model-row-action" onclick="toggleHwPanel('${model.id}', event)" title="Show on all hardware">${panelIcon}</div>
        <div class="model-row-right">
          <div class="perf-row">
            <span class="perf-key">Prefill</span>
            <span class="perf-val">${prefill === '—' ? '<span class="tps-dash">—</span>' : prefill + '/s'}</span>
          </div>
          <div class="perf-row">
            <span class="perf-key">TPS</span>
            <span class="perf-val ${tpsClass(calc.tps)}">${tps}</span>
          </div>
          <div class="perf-row">
            <span class="perf-key">max ctx</span>
            <span class="perf-val ${tpsClass(calc.tps_max_ctx)}">${tpsMax}</span>
          </div>
          <div class="perf-row">
            <span class="perf-key">Load</span>
            <span class="perf-val">${loadTime}</span>
          </div>
        </div>
      </div>
    `;
  }

  const availableGroup = available.length
    ? `<div class="group-header available">✓ Available</div>${available.map(modelRowHtml).join('')}`
    : `<div class="empty-state">No compatible models for this hardware</div>`;

  const oomGroup = oom.length
    ? `<div class="group-header oom" style="margin-top:12px">✗ OOM</div>${oom.map(modelRowHtml).join('')}`
    : `<div class="empty-state" style="margin-top:8px">All models fit</div>`;

  const selectedModel = (state.hwPanelOpen && state.selectedModelIdInHw)
    ? models.find(m => m.id === state.selectedModelIdInHw)
    : null;
  const thirdPanel = selectedModel ? buildHwModelPanel(selectedModel) : '';

  mount(`
    <div class="detail-shell${selectedModel ? ' three-col' : ''}">
      ${specPanel}
      <div class="result-list">
        ${availableGroup}
        ${oomGroup}
      </div>
      ${thirdPanel}
    </div>
  `);
}

// Called by hardware variant-row onclick
function selectHardwareVariant(idx) {
  state.selectedHwVariantIdx = idx;
  state.selectedModelIdInHw = null;
  state.hwPanelOpen = false;
  render();
}
window.selectHardwareVariant = selectHardwareVariant;

// Highlight a model row in Screen 2 (card click — no panel)
function selectModelHighlight(modelId) {
  state.selectedModelIdInHw = state.selectedModelIdInHw === modelId ? null : modelId;
  if (!state.selectedModelIdInHw) state.hwPanelOpen = false;
  render();
}
window.selectModelHighlight = selectModelHighlight;

// Toggle third panel for a model (icon button click)
function toggleHwPanel(modelId, event) {
  event.stopPropagation();
  if (state.selectedModelIdInHw === modelId && state.hwPanelOpen) {
    state.hwPanelOpen = false;
  } else {
    state.selectedModelIdInHw = modelId;
    state.hwPanelOpen = true;
  }
  render();
}
window.toggleHwPanel = toggleHwPanel;

// Build third panel: all hardware for a given model (Screen 2)
function buildHwModelPanel(model) {
  const varIdx = defaultVariantIdx(model);
  const variant = model.variants[varIdx];

  const hwEvaluated = hardware.map(hw => {
    const vars = hwVariants(hw);
    const fittingVar = vars
      .filter(v => v.vram_gb >= variant.vram_gb)
      .sort((a, b) => a.vram_gb - b.vram_gb)[0];

    if (!fittingVar) {
      const largestVar = vars.reduce((a, b) => b.vram_gb > a.vram_gb ? b : a);
      const eff = effectiveHw(hw, largestVar);
      return { hw, eff, fittingVar: largestVar, calc: calcAll(eff, model, variant), fits: false };
    }
    const eff = effectiveHw(hw, fittingVar);
    return { hw, eff, fittingVar, calc: calcAll(eff, model, variant), fits: true };
  });

  const available = hwEvaluated
    .filter(e => e.fits)
    .sort((a, b) => {
      const tA = typeof a.calc.tps === 'number' ? a.calc.tps : -1;
      const tB = typeof b.calc.tps === 'number' ? b.calc.tps : -1;
      return tB - tA;
    });

  const oom = hwEvaluated
    .filter(e => !e.fits)
    .sort((a, b) => b.eff.vram_gb - a.eff.vram_gb);

  function panelHwRowHtml({ hw, eff, fittingVar, calc, fits }) {
    const vars = hwVariants(hw);
    const varLabel = vars.length > 1
      ? ` <span class="hw-variant-label">${fittingVar.label}</span>`
      : '';
    if (!fits) {
      return `
        <div class="hw-row oom-row">
          <div>
            <div class="hw-row-name">${hw.name}${varLabel}</div>
            <div class="hw-row-sub">${eff.vram_gb} GB · needs ${variant.vram_gb} GB</div>
          </div>
          <span class="tps-badge tps-oom">OOM</span>
        </div>
      `;
    }
    return `
      <div class="hw-row">
        <div>
          <div class="hw-row-name">${hw.name}${varLabel}</div>
          <div class="hw-row-sub">${eff.vram_gb} GB · ${eff.memory_bandwidth_gbps} GB/s</div>
        </div>
        <span class="tps-badge ${tpsClass(calc.tps)}">${metricDisplay(calc.tps)} TPS</span>
      </div>
    `;
  }

  const availGroup = available.length
    ? `<div class="group-header available">✓ Available · ${variant.quant}</div>${available.map(panelHwRowHtml).join('')}`
    : `<div class="empty-state">No hardware fits this model</div>`;

  const oomGroup = oom.length
    ? `<div class="group-header oom" style="margin-top:12px">✗ OOM</div>${oom.map(panelHwRowHtml).join('')}`
    : '';

  return `
    <div class="hw-model-panel">
      <div class="hw-model-panel-title">${model.name}</div>
      <div class="hw-model-panel-sub">${variant.quant} · ${variant.vram_gb} GB · all hardware</div>
      ${availGroup}
      ${oomGroup}
    </div>
  `;
}

// ── Screen 3a: Models List ────────────────────────────────────────────────
function renderModelsList() {
  const sorted = [...models].sort((a, b) => b.total_params_b - a.total_params_b);

  const cards = sorted.map(model => {
    const archClass = model.architecture === 'moe' ? 'moe' : 'dense';
    const archLabel = model.architecture === 'moe' ? 'MoE' : 'Dense';
    const tierClass = tierBadgeClass(model.tier);
    const tierLabel = tierBadgeLabel(model.tier);

    const paramsLine = model.architecture === 'moe'
      ? `${model.total_params_b}B total · ${model.active_params_b}B active`
      : `${model.total_params_b}B params`;

    return `
      <div class="model-card" onclick="app.navigate('model-detail','${model.id}')">
        <div class="model-card-header">
          <div class="model-card-main">
            <span class="arch-badge ${archClass}">${archLabel}</span>
            <span class="tier-badge ${tierClass}">${tierLabel}</span>
          </div>
          <div class="model-card-tag-hdr">
            <span class="model-card-date"><span class="date-label">Released</span> ${model.release_date ?? ''}</span>
          </div>
        </div>
        <div class="model-card-body">
          <div class="model-card-main">
            <div class="model-card-name">${model.name}</div>
            <div class="model-card-specs">
              <span>${paramsLine}</span><br>
              <span>${ctxLabel(model.context_length_k)} ctx · ${model.license}</span>
            </div>
          </div>
          <div class="model-card-tag">${model.tagline ?? ''}</div>
        </div>
      </div>
    `;
  }).join('');

  mount(`
    <div class="page-title">Models</div>
    <div class="page-subtitle">Sorted by parameter count · click a card to see compatible hardware</div>
    <div class="card-grid">${cards}</div>
  `);
}

// ── Screen 3b: Model Detail ───────────────────────────────────────────────
function renderModelDetail() {
  const model = models.find(m => m.id === state.selectedModelId);
  if (!model) { navigate('models-list'); return; }

  const variant = model.variants[state.selectedVariantIdx] ?? model.variants[0];

  const archLabel = model.architecture === 'moe' ? 'MoE' : 'Dense';
  const tierClass = tierBadgeClass(model.tier);
  const tierLabel = tierBadgeLabel(model.tier);
  const specRowDefs = [
    ['Type',    archLabel],
    ['Params',  `${model.total_params_b}B total`],
    ...(model.architecture === 'moe' ? [['Active', `${model.active_params_b}B`]] : []),
    ['Context', ctxLabel(model.context_length_k)],
    ['License', model.license],
    ['Released', model.release_date ?? '—'],
  ];
  const specRows = specRowDefs.map(([k, v]) => `
    <div class="spec-row">
      <span class="spec-key">${k}</span>
      <span class="spec-val">${v}</span>
    </div>
  `).join('');

  const variantRows = model.variants.map((v, i) => `
    <div class="variant-row ${i === state.selectedVariantIdx ? 'selected' : ''}"
         onclick="selectVariant(${i})">
      <span class="v-quant">${v.quant}</span>
      <span class="v-vram">${v.vram_gb} GB</span>
    </div>
  `).join('');

  const notesHtml = (model.notes && model.notes.length) ? `
    <div class="notes-block">
      <div class="notes-label">ℹ Notes</div>
      <div class="notes-text">${model.notes.map(n => `<p>${n}</p>`).join('')}</div>
    </div>
  ` : '';

  const specPanel = `
    <div class="spec-panel">
      <span class="back-link" onclick="app.navigate('models-list')">← Models</span>
      <div class="model-card-header" style="margin-bottom:8px">
        <div>
          <span class="arch-badge ${model.architecture === 'moe' ? 'moe' : 'dense'}">${archLabel}</span>
          <span class="tier-badge ${tierClass}">${tierLabel}</span>
        </div>
      </div>
      <div class="spec-panel-title">${model.name}</div>
      ${model.tagline ? `<div class="spec-tagline">${model.tagline}</div>` : ''}
      ${specRows}
      <div class="variants-section-label">Variants</div>
      ${variantRows}
      ${notesHtml}
    </div>
  `;

  // For each hardware family: find smallest hw variant that fits the model variant.
  // If none fits, use the largest hw variant for OOM display.
  const evaluated = hardware.map(hw => {
    const vars = hwVariants(hw);
    const fittingVar = vars
      .filter(v => v.vram_gb >= variant.vram_gb)
      .sort((a, b) => a.vram_gb - b.vram_gb)[0]; // smallest that fits

    if (!fittingVar) {
      const largestVar = vars.reduce((a, b) => b.vram_gb > a.vram_gb ? b : a);
      const eff = effectiveHw(hw, largestVar);
      return { hw, eff, fittingVar: largestVar, calc: calcAll(eff, model, variant), fits: false };
    }
    const eff = effectiveHw(hw, fittingVar);
    return { hw, eff, fittingVar, calc: calcAll(eff, model, variant), fits: true };
  });

  const available = evaluated
    .filter(e => e.fits)
    .sort((a, b) => {
      const tpsA = typeof a.calc.tps === 'number' ? a.calc.tps : -1;
      const tpsB = typeof b.calc.tps === 'number' ? b.calc.tps : -1;
      return tpsB - tpsA;
    });

  const oom = evaluated
    .filter(e => !e.fits)
    .sort((a, b) => b.eff.vram_gb - a.eff.vram_gb);

  function hwRowHtml({ hw, eff, fittingVar, calc, fits }) {
    const vars = hwVariants(hw);
    const varLabel = vars.length > 1
      ? ` <span class="hw-variant-label">${fittingVar.label}</span>`
      : '';

    if (!fits) {
      return `
        <div class="hw-row oom-row">
          <div>
            <div class="hw-row-name">${hw.name}${varLabel}</div>
            <div class="hw-row-sub">${eff.vram_gb} GB available · needs ${variant.vram_gb} GB</div>
          </div>
          <span class="tps-badge tps-oom">OOM</span>
        </div>
      `;
    }
    return `
      <div class="hw-row">
        <div>
          <div class="hw-row-name">${hw.name}${varLabel}</div>
          <div class="hw-row-sub">${eff.vram_gb} GB · ${eff.memory_bandwidth_gbps} GB/s</div>
        </div>
        <span class="tps-badge ${tpsClass(calc.tps)}">${metricDisplay(calc.tps)} TPS</span>
      </div>
    `;
  }

  const availableGroup3b = available.length
    ? `<div class="group-header available">✓ Available · ${variant.quant} (${variant.vram_gb} GB)</div>${available.map(hwRowHtml).join('')}`
    : `<div class="empty-state">No hardware fits this model</div>`;

  const oomGroup3b = oom.length
    ? `<div class="group-header oom" style="margin-top:12px">✗ OOM</div>${oom.map(hwRowHtml).join('')}`
    : `<div class="empty-state" style="margin-top:8px">All devices support this model</div>`;

  mount(`
    <div class="detail-shell">
      ${specPanel}
      <div class="result-list">
        ${availableGroup3b}
        ${oomGroup3b}
      </div>
    </div>
  `);
}

// Called by model variant-row onclick
function selectVariant(idx) {
  state.selectedVariantIdx = idx;
  render();
}
window.selectVariant = selectVariant;
