"use client";

import { useId, useRef, useState } from "react";
import { api, assetUrl } from "@/lib/api";
import { ACCEPT_ATTR, ACCEPT_MIME, MAX_EDGE, shrinkImage } from "@/lib/imageResize";

// 通用图片上传控件（管理态）。
//
// 只产出 URL，不负责落库——调用方拿到 url 后随自己那张表单一起保存
// （头像走 PUT /auth/profile，封面走作品保存）。所以「传完还没保存」时页面上
// 看到的是新图、库里还是旧值，这是刻意的：上传不该有副作用。
//
// 设计约束（docs/design/DESIGN.md §6/§7）：真 <button> 触发隐藏 file input，
// 可见 label，错误 role="alert"，上传中/空/失败三态齐全，样式只引 tokens 变量。

const MAX_MB = 5; // 与后端 UPLOAD_MAX_MB 默认值一致

export default function ImageUpload({
  kind,
  value,
  onChange,
  label,
  hint,
}: {
  kind: "avatar" | "cover";
  value: string;
  onChange: (url: string) => void;
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    // 前端先挡一道：类型不对/太大时不必等一个必然失败的往返。
    // 但这只是体验优化——真正的校验在后端嗅探文件头，前端这层可以被绕过。
    if (!ACCEPT_MIME.includes(file.type)) {
      setError("只支持 JPG / PNG / WebP / GIF 图片");
      return;
    }

    setBusy(true);
    try {
      const blob = await shrinkImage(file, MAX_EDGE[kind]);
      if (blob.size > MAX_MB * 1024 * 1024) {
        setError(`图片压缩后仍超过 ${MAX_MB}MB，请换一张`);
        return;
      }
      onChange(await api.upload(kind, blob, file.name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      // 清空 input：否则连续两次选同一个文件不会触发 change。
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const shape = kind === "avatar" ? "circle" : "cover";
  const src = assetUrl(value);

  return (
    <div className="ed-field">
      <span className="ed-label" id={`${errId}-label`}>
        {label}
        {hint && <span className="ed-hint">{hint}</span>}
      </span>

      <div className="up-row">
        <div className={`up-preview ${shape}`} data-busy={busy ? "1" : undefined}>
          {src ? (
            // 原生 <img>：项目未配 next/image 的 remotePatterns，
            // 且这些图来自后端同源静态目录，用不上 next/image 的优化。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" />
          ) : (
            <span className="up-empty" aria-hidden="true">
              {busy ? "" : "未上传"}
            </span>
          )}
          {busy && <span className="up-spin" aria-hidden="true" />}
        </div>

        <div className="up-actions">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="up-file"
            aria-labelledby={`${errId}-label`}
            aria-describedby={error ? errId : undefined}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "上传中…" : value ? "更换图片" : "选择图片"}
          </button>
          {value && !busy && (
            <button type="button" className="btn ghost sm up-remove" onClick={() => onChange("")}>
              移除
            </button>
          )}
          <span className="ed-hint">最大 {MAX_MB}MB · JPG/PNG/WebP/GIF</span>
        </div>
      </div>

      {error && (
        <span className="up-err" id={errId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
