/**
 * 哪些实验已经有了 React 侧的 3D 场景。
 *
 * 沙盒卡片上的「✨ 3D 沉浸模式」角标标的是 **3D 适配度**（`experiments.ts` 的 `threeD === "high"`，
 * 一共 5 个），但只有在这里登记过的才能点 —— 否则点出一个 404，比不给链接更糟。
 */
const BUILT = new Set(["e04", "e08", "e12", "e22", "e27"]);

export function lab3dHref(experimentId: string): string | null {
  return BUILT.has(experimentId) ? `/lab/${experimentId}` : null;
}
