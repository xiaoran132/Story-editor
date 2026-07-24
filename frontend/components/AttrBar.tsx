import { formatAttrValue, parseState } from "@/lib/state";

export default function AttrBar({ stateJSON }: { stateJSON: string | null }) {
  const state = parseState(stateJSON);
  const keys = Object.keys(state);
  if (!keys.length) return null;
  return (
    <div className="attrs">
      {keys.map((k) => (
        <div className="attr" key={k}>
          <b>{k}</b>
          <span className="val">{formatAttrValue(state[k])}</span>
        </div>
      ))}
    </div>
  );
}
