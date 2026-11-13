import { useEffect, useRef, useState, type ReactNode } from "react";
import { animateEnter, animateExit, cancelAnimations, prefersReducedMotion } from "@/lib/motion";

interface PageTransitionProps {
  /** 当前路由路径，变化时触发一次「旧页淡出 → 新页淡入」。 */
  path: string;
  /** 按路径渲染页面内容（内部保留上一页 DOM 直到退出动画结束）。 */
  render: (path: string) => ReactNode;
}

/**
 * 自研页面切换动效：旧内容逐块淡出（保留 DOM、关闭 pointer-events），
 * 退出结束后换成新内容并逐块淡入。快速连点共享同一次退出，不叠加动画。
 */
export function PageTransition({ path, render }: PageTransitionProps) {
  const [shownPath, setShownPath] = useState(path);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef(path);
  const exitingRef = useRef(false);

  // 系统要求减少动效时，在 render 阶段直接对齐目标页（同组件内派生状态调整）。
  if (prefersReducedMotion() && path !== shownPath) {
    setShownPath(path);
  }

  // 最新目标路径只在 effect 中同步，避免 render 阶段读写 ref。
  useEffect(() => {
    targetRef.current = path;
  }, [path]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || path === shownPath || prefersReducedMotion()) {
      return;
    }
    // 快速连点：已有退出在跑就只更新目标，不重复播放动画。
    if (exitingRef.current) {
      return;
    }
    exitingRef.current = true;
    cancelAnimations(container);
    container.style.pointerEvents = "none";
    const wait = animateExit(container);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      exitingRef.current = false;
      container.style.pointerEvents = "";
      cancelAnimations(container);
      setShownPath(targetRef.current);
    }, wait);
  }, [path, shownPath]);

  // 内容换成新页后做入场。
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || prefersReducedMotion()) {
      return;
    }
    cancelAnimations(container);
    animateEnter(container);
  }, [shownPath]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return <div ref={containerRef}>{render(shownPath)}</div>;
}
