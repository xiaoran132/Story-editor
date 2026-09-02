// 上传前的客户端压缩。
//
// 服务端刻意只做校验、原图落盘（见 docs/handoff.md「图片上传」），所以缩放这件事
// 必须在这边补上——否则手机直出的 8MB 照片会直接撞上后端 5MB 上限，
// 用户只看到一句「超出大小限制」，却不知道该怎么办。

export const MAX_EDGE = { avatar: 512, cover: 1280 } as const;

// 与后端 pkg/upload.go 的白名单保持一致（SVG 故意不在其中）。
export const ACCEPT_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const ACCEPT_ATTR = ACCEPT_MIME.join(",");

/**
 * 等比缩到最长边 maxEdge 以内，导出 webp。
 * - 已经够小的图原样返回，不做无谓的重编码（重编码只会掉画质）。
 * - GIF 一律原样返回：canvas 只画得出第一帧，压一下动画就没了。
 * - 任何一步失败都回退成原文件——压缩是优化，不该成为上传失败的理由。
 */
export async function shrinkImage(file: File, maxEdge: number): Promise<File | Blob> {
  if (file.type === "image/gif") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale === 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85)
  );
  return blob ?? file;
}
