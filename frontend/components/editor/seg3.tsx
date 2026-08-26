"use client";

import AttrTable from "./AttrTable";
import { NavBtns } from "./fields";
import styles from "./editor.module.css";
import type { SegProps } from "./segTypes";

// 第 3 段 · 属性。
export default function Seg3({ go, names }: SegProps) {
  return (
    <>
          <>
            <p className={styles.desc}>
              属性完全自定义，不限定字段。类型决定合并方式：<strong>number</strong> 累加、
              <strong>scalar</strong> 覆盖、<strong>set</strong> 集合增删。
            </p>
            <p className={styles.hint}>
              三态在进度天空上直接可见：普通属性是一颗亮星，<strong>门控</strong>是不发光的虚线待亮环，
              而<strong>隐藏</strong>属性不会出现在天空上——它仅供 AI 参考，玩家始终不可见；
              若为它画一颗星，等于把不可见的设定呈现为可见成果。
            </p>
            <AttrTable />
            <NavBtns index={2} names={names} onGo={go} />
          </>
    </>
  );
}
