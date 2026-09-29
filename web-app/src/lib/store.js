const STORE_KEY = "linernotes.v1";

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { passes: {}, annotations: {} };
    const parsed = JSON.parse(raw);
    return { passes: parsed.passes || {}, annotations: parsed.annotations || {} };
  } catch {
    return { passes: {}, annotations: {} };
  }
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode or quota — ignore */
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
