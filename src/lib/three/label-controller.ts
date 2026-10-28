/* DOM 标签跟随 3D 投影。
 *
 * 关键设计：锚点的 left/top 仍然保留原来按设计稿百分比写死的定位（WingNode.tsx 不变），
 * 这里只额外叠一个 **增量 transform**。好处有两个：
 *  - 只写 transform，不写 left/top，不会每帧触发布局回流；
 *  - 万一 JS 停摆（节能档不挂 rig、WebGL 创建失败、脚本出错），标签仍然待在正确位置，
 *    不会集体飞到左上角。
 */
import * as THREE from "three";
import { fractionToDesignPx, toWorld } from "./design-space";
import { MODULE_NODES, type NodeId } from "../nodes";

export type LabelController = {
  /** 从 [data-node-id] 收集锚点元素；DOM 顺序无关，靠属性匹配 */
  collect(root: ParentNode): void;
  place(camera: THREE.Camera, width: number, height: number): void;
  reset(): void;
};

/**
 * positionOf 给的是**节点环当前的世界坐标**。环挂在翼 pivot 下，折叠时它会动，
 * 标签只有投影同一个点才不会出现"字停在原地、环走开了"的错位。
 * 不传（或拿不到）就退回静态设计坐标。
 */
export function createLabelController(
  positionOf?: (id: NodeId, out: THREE.Vector3) => THREE.Vector3 | null,
): LabelController {
  const refs = new Map<NodeId, HTMLElement>();

  const anchors = MODULE_NODES.map((node) => {
    const [px, py] = fractionToDesignPx(node.x, node.y);
    const [wx, wy, wz] = toWorld(px, py);
    return { id: node.id, fx: node.x, fy: node.y, world: new THREE.Vector3(wx, wy, wz) };
  });

  const projected = new THREE.Vector3();

  return {
    collect(root) {
      refs.clear();
      for (const node of MODULE_NODES) {
        const element = root.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
        if (element) refs.set(node.id, element);
      }
    },

    place(camera, width, height) {
      if (!width || !height) return;

      for (const anchor of anchors) {
        const element = refs.get(anchor.id);
        if (!element) continue;

        positionOf?.(anchor.id, anchor.world);
        projected.copy(anchor.world).project(camera);
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;

        const screenX = ((projected.x + 1) / 2) * width;
        const screenY = ((1 - projected.y) / 2) * height;
        const deltaX = screenX - anchor.fx * width;
        const deltaY = screenY - anchor.fy * height;

        /* 亚像素用两位小数足够，写更长的字符串只是白白增加样式解析 */
        element.style.transform = `translate3d(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px, 0)`;
      }
    },

    reset() {
      for (const element of refs.values()) element.style.transform = "";
    },
  };
}
