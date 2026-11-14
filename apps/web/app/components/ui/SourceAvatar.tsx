import { useState } from "react";
import { sourceInitial } from "../../lib/format";

/** Round avatar for X accounts (or a source icon); a tinted initial when there is no image. */
export function SourceAvatar({ name, iconUrl, avatarUrl, iconSrcSet, avatarSrcSet, size = 18 }: { name: string; iconUrl?: string | null; avatarUrl?: string | null; iconSrcSet?: string; avatarSrcSet?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = avatarUrl ?? iconUrl;
  if (src && !failed) {
    return (
      <img
        src={src}
        srcSet={avatarUrl ? avatarSrcSet : iconSrcSet}
        sizes={`${size}px`}
        decoding="async"
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-bg-sunk object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: size >= 40 ? 16 : 12 }}
    >
      {sourceInitial(name)}
    </span>
  );
}
