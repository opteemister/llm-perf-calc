export function canRun(hardware, variant) {
  return variant.vram_gb <= hardware.vram_gb;
}

export function memoryUsagePct(hardware, variant) {
  return (variant.vram_gb / hardware.vram_gb) * 100;
}

// Apple Ultra chips are dual-die. If model fits in < single_die_vram_gb, only one die is used.
export function effectiveBandwidth(hardware, variant) {
  if (hardware.special_behavior?.dual_die) {
    if (variant.vram_gb < hardware.special_behavior.single_die_vram_gb) {
      return hardware.special_behavior.single_die_bandwidth_gbps;
    }
  }
  return hardware.memory_bandwidth_gbps;
}

// Each token = read all active weights once through memory
export function calcTPS(hardware, model, variant) {
  if (!canRun(hardware, variant)) return null;
  const bw = effectiveBandwidth(hardware, variant);
  const bytes_per_token = model.active_params_b * 1e9 * (variant.bits_per_weight / 8);
  const tps = (bw * 1e9) / bytes_per_token;
  return Math.round(tps * 0.75);
}

// Returns number, or "OOM" string if model+KV won't fit in VRAM
export function calcTPSMaxCtx(hardware, model, variant) {
  if (!canRun(hardware, variant)) return null;
  if (variant.vram_gb + variant.kv_cache_gb_at_full_ctx > hardware.vram_gb) {
    return "OOM";
  }
  const bw = effectiveBandwidth(hardware, variant);
  const bytes_model = model.active_params_b * 1e9 * (variant.bits_per_weight / 8);
  const bytes_kv = variant.kv_cache_gb_at_full_ctx * 1e9;
  const bytes_total = bytes_model + bytes_kv;
  return Math.round((bw * 1e9) / bytes_total * 0.75);
}

// Apple Silicon: NVMe → unified memory directly
// Discrete GPU: NVMe → RAM → PCIe → VRAM (PCIe is often the bottleneck)
export function calcLoadTime(hardware, variant) {
  let effective_read = hardware.storage_read_gbps;
  if (effective_read === null) return null;
  if (hardware.pcie_bandwidth_gbps !== null && hardware.type !== 'apple_silicon') {
    effective_read = Math.min(effective_read, hardware.pcie_bandwidth_gbps);
  }
  return (variant.disk_gb / effective_read).toFixed(1);
}

// Returns null if compute_tflops_fp16 is null (no data)
export function calcPrefillTPS(hardware, model) {
  if (hardware.compute_tflops_fp16 === null) return null;
  const flops_per_token = 2 * model.active_params_b * 1e9;
  const tflops_available = hardware.compute_tflops_fp16 * 1e12;
  return Math.round(tflops_available / flops_per_token * 0.5);
}

export function calcAll(hardware, model, variant) {
  return {
    can_run: canRun(hardware, variant),
    memory_usage_pct: memoryUsagePct(hardware, variant),
    effective_bandwidth_gbps: effectiveBandwidth(hardware, variant),
    tps: calcTPS(hardware, model, variant),
    tps_max_ctx: calcTPSMaxCtx(hardware, model, variant),
    load_time_s: calcLoadTime(hardware, variant),
    prefill_tps: calcPrefillTPS(hardware, model),
  };
}
