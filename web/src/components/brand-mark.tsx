interface BrandMarkProps {
  className?: string;
}

/**
 * 品牌图标：等距立方体 + 播放三角，六块离散实色，不使用纯色渐变。
 * 与 packaging/icons/icon.svg、src/desktop.rs 的 ICON_SVG 是同一套图形，
 * 所以窗口、托盘、桌面快捷方式、网页与 PWA 看到的都是同一个图标。
 */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#2078da" />
      <path d="M32 12 L52 23 L32 34 L12 23 Z" fill="#9ec1ee" />
      <path d="M12 23 L32 34 L32 52 L12 41 Z" fill="#5291df" />
      <path d="M52 23 L32 34 L32 52 L52 41 Z" fill="#1662b6" />
      <path
        d="M12 23 L32 12 L52 23 L32 34 Z M32 34 L32 52 M12 23 L12 41 L32 52 L52 41 L52 23"
        fill="none"
        stroke="#0b4a92"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M28 25 L40 31 L28 37 Z" fill="#ffffff" />
    </svg>
  );
}
