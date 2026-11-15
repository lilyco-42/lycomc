import { Boxes, DatabaseBackup, Download, House, Puzzle, Settings2, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  /** 顶部蓝色标题栏里的短标签 */
  short: string;
  icon: LucideIcon;
}

/** 全站导航：顶部胶囊用 short，左侧分组栏用 label。 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "主页", short: "启动", icon: House },
  { to: "/versions", label: "版本管理", short: "版本", icon: Boxes },
  { to: "/download", label: "下载", short: "下载", icon: Download },
  { to: "/mods", label: "Mod 管理", short: "Mod", icon: Puzzle },
  { to: "/settings", label: "设置", short: "设置", icon: Settings2 },
  { to: "/backup", label: "备份与清理", short: "备份", icon: DatabaseBackup },
];
