// Android port: can this browser actually run local GPU models?
//
// bitgpu and WebLLM both need real WebGPU. Chrome for Android provides it on
// Android 12+ with a supported GPU; older phones, browsers other than Chrome,
// and locked-down WebViews may not. When it is missing the app must stay
// useful, so main.js falls back to Online Assist instead of dead-ending.

// ?nogpu=1 forces the unsupported path so the fallback can be exercised
// without a weak device (used by tools/check.mjs and for manual testing).
const FORCE_NO_GPU =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("nogpu") !== null;

// bitgpu streams weights through storage buffers. The WebGPU default is
// 128 MiB; anything below this floor cannot run the bundled models usefully.
const MIN_STORAGE_BUFFER_BYTES = 64 * 1024 * 1024;

export function forcedOff() {
  return FORCE_NO_GPU;
}

// Takes the shape returned by inspect() in main.js and turns it into a
// yes/no answer plus a sentence a person can act on.
export function assessGpu(h) {
  if (!h) {
    return { supported: false, reason: "Local AI support could not be checked on this browser." };
  }
  if (!h.secureContext) {
    return { supported: false, reason: "Local AI needs a secure HTTPS connection." };
  }
  if (!h.webgpu) {
    return {
      supported: false,
      reason:
        "This browser does not provide WebGPU, so local models cannot run here. Online Assist still works over the internet.",
    };
  }
  if (!h.adapter) {
    return {
      supported: false,
      reason:
        "WebGPU is present, but this device did not provide a usable GPU. Online Assist still works over the internet.",
    };
  }
  if (!h.device) {
    return {
      supported: false,
      reason:
        "WebGPU found a GPU but could not create a device for it. Online Assist still works over the internet.",
    };
  }
  const cap = h.limits?.maxStorageBufferBindingSize ?? h.maxBuffer ?? 0;
  if (cap && cap < MIN_STORAGE_BUFFER_BYTES) {
    return {
      supported: false,
      reason: `This GPU only exposes ${Math.round(cap / 1048576)} MB of storage buffer, too little for the local models. Online Assist still works.`,
    };
  }
  return { supported: true, reason: "" };
}
