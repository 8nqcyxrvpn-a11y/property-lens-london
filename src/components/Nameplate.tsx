/** An address set like a London street nameplate. */
export function Nameplate({ street, district, size = "md" }: { street: string; district: string; size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-3xl sm:text-4xl" : size === "md" ? "text-xl" : "text-base";
  return (
    <div className="nameplate max-w-full">
      <div className={`nameplate__street ${text} break-words`}>{street}</div>
      <div className="nameplate__district">{district}</div>
    </div>
  );
}
