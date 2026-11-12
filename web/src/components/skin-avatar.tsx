import { useEffect, useRef } from "react";
import { api, type SkinModel } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SkinAvatarProps {
  skinUrl?: string | null;
  model?: SkinModel;
  size?: number;
  className?: string;
  /** 后端标记的兜底皮肤：直接用本地 Steve / Alex，不再请求代理 */
  fallback?: boolean;
  title?: string;
}

function builtinSkin(model: SkinModel): string {
  return model === "slim" ? "/alex.png" : "/steve.png";
}

/**
 * 从 64x64 Minecraft 皮肤裁出正面头部，并叠加帽子层。
 * 走 /api/skin/image 同源代理，避免外域图片污染 canvas；图片异常时回退内置 PNG。
 */
export function SkinAvatar({
  skinUrl,
  model = "classic",
  size = 40,
  className,
  fallback = false,
  title = "玩家皮肤头像",
}: SkinAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const builtin = builtinSkin(model);
  const source = skinUrl === null || skinUrl === undefined || skinUrl === "" || fallback
    ? builtin
    : api.skinImage(skinUrl, model);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    let cancelled = false;
    let triedBuiltin = source === builtin;
    const image = new Image();

    const paint = () => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, size, size);
      context.imageSmoothingEnabled = false;
      // 标准 64x64 皮肤：基础头 8,8，帽子层 40,8，各 8x8 像素
      context.drawImage(image, 8, 8, 8, 8, 0, 0, size, size);
      if (image.width >= 64 && image.height >= 64) {
        context.drawImage(image, 40, 8, 8, 8, 0, 0, size, size);
      }
    };

    image.onload = paint;
    image.onerror = () => {
      if (cancelled || triedBuiltin) {
        return;
      }
      triedBuiltin = true;
      image.src = builtin;
    };
    image.src = source;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [source, builtin, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      className={cn("shrink-0 rounded-lg bg-muted", className)}
    />
  );
}
