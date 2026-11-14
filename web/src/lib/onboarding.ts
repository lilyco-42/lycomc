/** 新手引导「是否看过」的本地标记：与其它本地状态一样存在 localStorage。 */

const ONBOARDED_KEY = "lycomc.onboarded";

/** 顶栏 / 侧栏请求「重新看一遍引导」时派发的事件名。 */
export const GUIDE_EVENT = "lycomc:reopen-guide";

/** 重新打开新手引导：不写任何服务端状态，只影响当前这次显示。 */
export function requestOnboarding(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(GUIDE_EVENT));
}

export function hasOnboarded(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // 隐私模式下 localStorage 可能不可写，读不到就当没看过
    return false;
  }
}

export function markOnboarded(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // 存不下来也没关系，最多下次再看一遍引导
  }
}

/** 给「引导」按钮用：重新看一遍时不会影响其它数据。 */
export function clearOnboarded(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(ONBOARDED_KEY);
  } catch {
    // 忽略
  }
}
