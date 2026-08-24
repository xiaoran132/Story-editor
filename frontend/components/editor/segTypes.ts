// 六段共用的入参。段落可任意跳转（DESIGN.md §7.7），所以每段都要能发起跳转。
export type SegProps = {
  go: (i: number) => void;
  names: readonly string[];
};
