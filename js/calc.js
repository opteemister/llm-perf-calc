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

// MoE models have lower effective bandwidth utilization than dense models:
// - Dense: sequential weight reads → high utilization (0.75)
// - MoE on Apple Silicon: unified memory is marginally better than discrete GPU
//   for random expert access, but Metal/MLX MoE kernels are less optimized (0.22)
// - MoE on unified CUDA (DGX Spark GB10): same unified memory architecture as Apple
//   but CUDA inference stack is significantly better optimized for MoE routing (0.35)
// - MoE on discrete GPU: experts scattered across VRAM, cache misses dominate (0.15)
// AMD ROCm is ~25% less efficient than CUDA for equivalent hardware
// Calibrated against Qwen3.5 35B A3B MoE Q4_K_M benchmarks.
function inferenceEfficiency(hardware, model) {
  const isMoe = model.architecture === 'moe';
  if (!isMoe) return 0.75;
  if (hardware.type === 'apple_silicon') return 0.22;
  if (hardware.type === 'unified_cuda') return 0.35;
  let eff = 0.15;
  if (hardware.type === 'amd_gpu') eff *= 0.75;
  return eff;
}

// Hardware with native support for specific quantization formats eliminates
// dequantization overhead, giving ~30% throughput boost
function nativeQuantMultiplier(hardware, variant) {
  if (!hardware.native_quants?.length) return 1.0;
  return hardware.native_quants.includes(variant.quant) ? 1.3 : 1.0;
}

// Each token = read all active weights once through memory
export function calcTPS(hardware, model, variant) {
  if (!canRun(hardware, variant)) return null;
  const bw = effectiveBandwidth(hardware, variant);
  const bytes_per_token = model.active_params_b * 1e9 * (variant.bits_per_weight / 8);
  return Math.round((bw * 1e9) / bytes_per_token * inferenceEfficiency(hardware, model) * nativeQuantMultiplier(hardware, variant));
}

// Returns TPS at a given context length in K tokens (0 = empty context = peak TPS).
// Returns 'OOM' if the KV cache at that context does not fit alongside model weights.
export function calcTPSAtCtx(hardware, model, variant, ctx_k) {
  if (!canRun(hardware, variant)) return null;
  if (ctx_k <= 0) return calcTPS(hardware, model, variant);
  const eff_ctx_k = Math.min(ctx_k, model.context_length_k);
  const kv_fraction = eff_ctx_k / model.context_length_k;
  const kv_gb = variant.kv_cache_gb_at_full_ctx * kv_fraction;
  if (variant.vram_gb + kv_gb > hardware.vram_gb) return 'OOM';
  const bw = effectiveBandwidth(hardware, variant);
  const bytes_model = model.active_params_b * 1e9 * (variant.bits_per_weight / 8);
  const bytes_kv = kv_gb * 1e9;
  const efficiency = inferenceEfficiency(hardware, model) * nativeQuantMultiplier(hardware, variant);
  return Math.round((bw * 1e9) / (bytes_model + bytes_kv) * efficiency);
}

// Max context TPS — delegates to calcTPSAtCtx at full context
export function calcTPSMaxCtx(hardware, model, variant) {
  return calcTPSAtCtx(hardware, model, variant, model.context_length_k);
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
