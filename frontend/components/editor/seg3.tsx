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
              属性完全自定义，后端不硬编码。类型决定合并方式：<strong>number</strong> 累加、
              <strong>scalar</strong> 覆盖、<strong>set</strong> 集合增删。
            </p>
            <p className={styles.hint}>
              三态在左边那片天空上直接看得见：普通属性是一颗亮星，<strong>门控</strong>是不发光的虚线待亮环，
              而<strong>隐藏</strong>属性**根本不上天**——它只供 AI 参考，玩家永不可见，在进度天空上给它一颗星
              等于把一个隐藏变量画成了可见成果。
            </p>
            <AttrTable />
            <NavBtns index={2} names={names} onGo={go} />
          </>
    </>
  );
}
