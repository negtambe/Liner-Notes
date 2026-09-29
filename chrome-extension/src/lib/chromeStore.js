const STORE_KEY = "linernotes_v1";

export async function loadStore() {
  try {
    const result = await chrome.storage.local.get(STORE_KEY);
    const parsed = result[STORE_KEY];
    if (!parsed) return { passes: {}, annotations: {} };
    return { passes: parsed.passes || {}, annotations: parsed.annotations || {} };
  } catch {
    return { passes: {}, annotations: {} };
  }
}

export async function saveStore(store) {
  try {
    await chrome.storage.local.set({ [STORE_KEY]: store });
  } catch {
    /* ignore */
  }
}

export const TAGS = [
  { id: "drop", label: "Drop", varName: "--tag-drop" },
  { id: "transition", label: "Transition", varName: "--tag-transition" },
  { id: "energy", label: "Energy", varName: "--tag-energy" },
  { id: "sample", label: "Sample", varName: "--tag-sample" },
  { id: "memory", label: "Memory", varName: "--tag-memory" },
];

export function tagMeta(id) {
  return TAGS.find((t) => t.id === id) || TAGS[0];
}

export function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
