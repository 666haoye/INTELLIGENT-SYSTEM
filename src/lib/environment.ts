type ConnectionLike = {
  effectiveType?: string;
  saveData?: boolean;
};

export function getConnection(): ConnectionLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (
    (navigator as Navigator & { connection?: ConnectionLike }).connection ??
    (navigator as Navigator & { mozConnection?: ConnectionLike }).mozConnection
  );
}

/** Weak network / reduced motion / low-end hardware get the fully static butterfly. */
export function shouldUseStaticFallback(): boolean {
  if (typeof window === "undefined") return false;

  if (!navigator.onLine) return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;

  const connection = getConnection();
  if (connection?.saveData) return true;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) {
    return true;
  }

  /* Low-end devices: static, highlighted nodes only. */
  const cores = navigator.hardwareConcurrency;
  if (typeof cores === "number" && cores <= 2) return true;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === "number" && memory <= 2) return true;

  return false;
}

/** PC: 4 trails. Tablets: 3. Phones and low-core devices: 2. */
export function getTrailCount(): number {
  if (typeof window === "undefined") return 4;

  const cores = navigator.hardwareConcurrency ?? 8;
  const width = window.innerWidth;

  if (width < 640 || cores <= 4) return 2;
  if (width < 1024) return 3;
  return 4;
}

export function readStoredFlag(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode / blocked storage */
  }
}
