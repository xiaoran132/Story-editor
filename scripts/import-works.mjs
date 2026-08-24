#!/usr/bin/env node
// 一次性把 works-fixture.json 里的作品导入后端。
//
// 这不是 seed：不被任何启动流程调用，只在需要补作品时手工执行一次。
// （启动期 seed 已于 2026-08-12 整个删除——它每次开机都在生产库上跑夹具代码，含删除逻辑。）
//
// 走公开 API 而非直连数据库：导进去的数据必须是真作者也能造出来的，
// 发布时的 pkg.ValidateWorldConfig strict 校验一视同仁，不存在只有脚本能写出的特权数据。
//
// 用法：
//   node scripts/import-works.mjs --email <邮箱> --password <密码>
//   node scripts/import-works.mjs --email ... --password ... --dry-run
//   node scripts/import-works.mjs --email ... --password ... --api http://localhost:8080/api/v1
//
// 幂等：同名作品已存在则跳过，重复执行不会产生副本。

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const API = arg("api", process.env.API_BASE || "http://localhost:8080/api/v1").replace(/\/$/, "");
const EMAIL = arg("email");
const PASSWORD = arg("password");
const DRY = has("dry-run");

if (!EMAIL || !PASSWORD) {
  console.error("缺少凭据。用法：node scripts/import-works.mjs --email <邮箱> --password <密码> [--dry-run]");
  process.exit(2);
}

// 后端信封是 {success, data, error}；失败时把 error.message 抛出来，不吞。
async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} → HTTP ${res.status}，响应不是 JSON：${text.slice(0, 200)}`);
  }
  if (!res.ok || json.success === false) {
    const e = json.error || {};
    throw new Error(`${method} ${path} → HTTP ${res.status} ${e.code ?? ""} ${e.message ?? text.slice(0, 200)}`);
  }
  return json.data;
}

// fixture 的扁平字段 → 后端的 Story + world_config。
// theme 存对象形态 {hue, figure}：Go 侧完全不解析 theme（零命中），纯透传。
function toPayload(w) {
  const initial_state = Object.fromEntries(
    Object.entries(w.attributes).map(([k, spec]) => [k, spec.initial])
  );
  return {
    title: w.title,
    description: w.description,
    opening_content: w.opening_content,
    // world_config 在 API 入参里是 JSON 字符串（service.StoryCreateInput.WorldConfig string），不是对象
    world_config: JSON.stringify({
      background: w.background,
      style: w.style,
      rules: w.rules,
      outline: w.outline,
      characters: w.characters,
      attributes: w.attributes,
      initial_state, // 规则 3/5：键集合与 attributes 严格一一对应，值与 initial 相等
      theme: w.theme,
      tags: w.tags,
    }),
  };
}

const works = JSON.parse(await readFile(join(HERE, "works-fixture.json"), "utf8"));
console.log(`fixture ${works.length} 部，目标 ${API}`);

let auth;
try {
  auth = await call("POST", "/auth/login", { body: { email: EMAIL, password: PASSWORD } });
} catch (e) {
  console.error(`登录失败：${e.message}`);
  console.error("确认后端已在运行，且邮箱/密码正确。");
  process.exit(1);
}
const token = auth.token;
console.log(`登录成功：${auth.user?.nickname || auth.user?.username}\n`);

const mine = await call("GET", "/stories/mine", { token });
const existing = new Set((mine?.items || mine || []).map((s) => s.title));

let created = 0;
let skipped = 0;
for (const w of works) {
  if (existing.has(w.title)) {
    console.log(`跳过（已存在）  ${w.title}`);
    skipped++;
    continue;
  }
  if (DRY) {
    console.log(`将创建        ${w.title}  hue=${w.theme.hue} figure=${w.theme.figure}`);
    continue;
  }
  const story = await call("POST", "/stories", { token, body: toPayload(w) });
  await call("PUT", `/stories/${story.id}/status`, { token, body: { status: "published" } });
  console.log(`已发布        ${w.title}  hue=${w.theme.hue}  ${story.id}`);
  created++;
}

console.log(`\n${DRY ? "试运行结束，未写入。" : `完成：新建并发布 ${created} 部，跳过 ${skipped} 部。`}`);
if (!DRY) console.log("阅读量保持 0——不伪造互动数据，排序按 created_at 退化，真人玩过才产生次序。");
