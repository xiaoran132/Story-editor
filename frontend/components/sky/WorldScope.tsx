import { createElement } from "react";
import type { CSSProperties, ElementType, ReactNode, Ref } from "react";

// 挂 --hue 的作用域容器。
//
// ⚠️ 这是 §4 的硬规则：--w-* 那一整套角色 token 必须声明在**使用它的元素**上，
// 不能放 :root。CSS 自定义属性在**声明处**就完成 var() 替换 —— 放 :root 的话
// 每张卡都会被锁成同一个根色相，整个 hue 系统当场失效。
//
// 用法：凡是要显示某部作品颜色的地方，外面套一层它。
// 挂载点（DESIGN.md §4「实际挂载点」）：星系卡、游玩页 scene/stagefig、
// 星图 starmap/panel、草稿箱 draft、设置页 pv/sw。

export type WorldScopeProps = {
  hue: number;
  /** 默认 div；星系卡是 button、SVG 里要用 g，都从这里换。 */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /**
   * 拿到真实节点。React 18 还不支持把 ref 当普通 prop 透传，而这里的 `as`
   * 是运行时才定的元素类型，forwardRef 的泛型标不出来——所以走一个显式的
   * innerRef。消费方：登录页要在生成期间挂 will-change、落定后释放。
   */
  innerRef?: Ref<Element>;
} & Record<string, unknown>;

export default function WorldScope({
  hue,
  as = "div",
  className,
  style,
  children,
  innerRef,
  ...rest
}: WorldScopeProps) {
  return createElement(
    as,
    {
      ...rest,
      ref: innerRef,
      className: className ? `world-scope ${className}` : "world-scope",
      // TS 不认自定义属性，必须断言。
      style: { ...(style ?? {}), "--hue": hue } as CSSProperties,
    },
    children,
  );
}
