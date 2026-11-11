import { Boxes, Download, House, Puzzle, Settings2, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** 左侧竖栏导航项：顺序即 PCL 风格的主次顺序。 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "主页", icon: House },
  { to: "/versions", label: "版本管理", icon: Boxes },
  { to: "/download", label: "下载", icon: Download },
  { to: "/mods", label: "Mod 管理", icon: Puzzle },
  { to: "/settings", label: "设置", icon: Settings2 },
];
