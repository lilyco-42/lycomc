import { Boxes, CircleHelp, DatabaseBackup, Download, House, Puzzle, Settings2, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  /** 顶部蓝色标题栏里的短标签 */
  short: string;
  icon: LucideIcon;
}

/** H39：帮助与关于入口；顶部胶囊与左侧「启动器」分组共用同一份元数据。 */
export const HELP_NAV_ITEM: NavItem = {
  to: "/help",
  label: "帮助与关于",
  short: "帮助",
  icon: CircleHelp,
};

/** 全站导航：顶部胶囊用 short，左侧分组栏用 label。 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "主页", short: "启动", icon: House },
  { to: "/versions", label: "版本管理", short: "版本", icon: Boxes },
  { to: "/download", label: "下载", short: "下载", icon: Download },
  { to: "/mods", label: "Mod 管理", short: "Mod", icon: Puzzle },
  { to: "/settings", label: "设置", short: "设置", icon: Settings2 },
  { to: "/backup", label: "备份与清理", short: "备份", icon: DatabaseBackup },
  HELP_NAV_ITEM,
];
