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

/* ==========================================================
   渲染分档：旗舰 / 节能
   3D 画面是用户本机 GPU 实时算的，服务器再强也替不了，
   所以设备能力必须在客户端判定并允许运行时降级。
   ========================================================== */

export type RenderTier = "flagship" | "eco";

/** 探测 WebGL2。用完立刻主动丢上下文，浏览器对同时存活的 WebGL 上下文有数量上限。 */
export function hasWebGL2(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否按移动设备对待。
 *
 * 只看 pointer:coarse，不看视口宽度 —— 宽度不是设备能力。
 * 这条是实测踩出来的：开发时 in-app 预览面板只有 530px 宽，
 * 用 width<768 判移动会把一台 20 核 16GB 的机器误降成节能档。
 * 真正的手机即便视口很宽（外接屏、平板横屏）也是 coarse pointer + 电池/发热受限。
 */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export type TierSignals = {
  webgl2: boolean;
  mobile: boolean;
  /** navigator.hardwareConcurrency，取不到时传 8 */
  cores: number;
  /** navigator.deviceMemory，取不到时传 8（Chrome 已不再上报，不能当成 0） */
  memory: number;
  saveData: boolean;
  slowNetwork: boolean;
  reducedMotion: boolean;
};

/**
 * 纯函数：把环境信号喂进去就能断言档位，不必开浏览器。
 * 判据宁保守不激进 —— 误判成 eco 只是少了特效，误判成 flagship 会让旧手机卡成 PPT。
 */
export function tierFromSignals(signals: TierSignals): RenderTier {
  if (!signals.webgl2) return "eco";
  if (signals.reducedMotion || signals.saveData || signals.slowNetwork) return "eco";
  if (signals.mobile) return "eco";
  if (signals.cores <= 4) return "eco";
  if (signals.memory <= 4) return "eco";
  return "flagship";
}

export function detectInitialTier(): RenderTier {
  if (typeof window === "undefined") return "eco";

  const connection = getConnection();
  return tierFromSignals({
    webgl2: hasWebGL2(),
    mobile: isMobileViewport(),
    cores: navigator.hardwareConcurrency ?? 8,
    memory:
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number"
        ? (navigator as Navigator & { deviceMemory: number }).deviceMemory
        : 8,
    saveData: Boolean(connection?.saveData),
    slowNetwork: Boolean(connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}
