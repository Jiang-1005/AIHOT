// Wrap short Chinese words and paired punctuation so headlines break between words (健康／第一, not 健康第／一).
// Ported from the 11-17 visual prototypes. The server's ICU may cut words differently from the browser's,
// so the server HTML and the hydrating render keep the plain text; the words are wrapped once mounted.
import { useEffect, useState } from "react";
import { isHydrated } from "../../lib/hydration";

const SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : null;

export function WordTitle({ children }: { children: string }) {
  const [ready, setReady] = useState(isHydrated);
  useEffect(() => setReady(true), []);
  if (!ready || !SEGMENTER) return children;
  return children.split(/([（(“《][^）)”》]{1,10}[）)”》])/).map((part, i) => {
    if (i % 2) return <span className="title-word" key={i}>{part}</span>;
    return [...SEGMENTER.segment(part)].map(({ segment, index }) => /^[\u4e00-\u9fff]{2,6}$/.test(segment)
      ? <span className="title-word" key={`${i}-${index}`}>{segment}</span>
      : segment);
  });
}
