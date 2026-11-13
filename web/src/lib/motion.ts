/**
 * 页面/卡片动效：参数参考 PCL.Proto 的行为规格（退出 70ms、stagger 15ms、
 * 位移 -6px、入场 y -20→0、opacity 0→1、delay 上限 0.24s、duration 0.6），
 * 实现完全自研（Web Animations API），不引用其任何源码。
 */

/** 动效时长与位移常量（毫秒/像素）。 */
export const MOTION = {
  exitDuration: 70,
  exitStagger: 15,
  exitOffset: -6,
  enterOffset: -20,
  enterStagger: 60,
  enterMaxDelay: 240,
  enterDuration: 600,
} as const;

/** 用户是否要求减少动效（系统级 prefers-reduced-motion）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 收集容器内需要参与动效的块（带 data-motion-block 的元素；没有则退回直接子元素）。 */
export function motionBlocks(root: HTMLElement): HTMLElement[] {
  const marked = Array.from(root.querySelectorAll<HTMLElement>("[data-motion-block]"));
  if (marked.length > 0) {
    return marked;
  }
  // 页面根通常标记为 data-motion-root：展开其直接子块做逐块 stagger。
  const pageRoot = root.querySelector<HTMLElement>("[data-motion-root]");
  const source = pageRoot ?? root;
  return Array.from(source.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
}

/** 退出动画：每块下移 6px 淡出，stagger 15ms，返回总耗时。 */
export function animateExit(root: HTMLElement): number {
  const blocks = motionBlocks(root);
  if (blocks.length === 0) {
    return 0;
  }
  let total: number = MOTION.exitDuration;
  blocks.forEach((block, index) => {
    const delay = Math.min(index * MOTION.exitStagger, MOTION.enterMaxDelay);
    total = Math.max(total, delay + MOTION.exitDuration);
    block.animate(
      [
        { opacity: 1, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(" + MOTION.exitOffset + "px)" },
      ],
      { duration: MOTION.exitDuration, delay, easing: "linear", fill: "forwards" },
    );
  });
  return total;
}

/** 入场动画：每块从 -20px 淡入，stagger 60ms（上限 240ms），600ms 缓出。 */
export function animateEnter(root: HTMLElement): void {
  const blocks = motionBlocks(root);
  blocks.forEach((block, index) => {
    const delay = Math.min(index * MOTION.enterStagger, MOTION.enterMaxDelay);
    block.animate(
      [
        { opacity: 0, transform: "translateY(" + MOTION.enterOffset + "px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: MOTION.enterDuration,
        delay,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      },
    );
  });
}

/** 取消某块上仍在跑的动画（快速连点时共享一次切换，避免叠加）。 */
export function cancelAnimations(root: HTMLElement): void {
  motionBlocks(root).forEach((block) => {
    block.getAnimations().forEach((animation) => animation.cancel());
  });
}
