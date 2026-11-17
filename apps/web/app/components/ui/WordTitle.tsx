// Keep short Chinese words and paired punctuation on one line so headlines break between words
// (健康第一 / 未成年人 stay whole). Ported from the 11-17 visual prototypes. The segmenter's dictionary cuts
// some words short (未成年|人, 健康|第|一), so a one-character piece joins its neighbour before wrapping.
// The server's ICU may cut words differently from the browser's, so the server HTML and the hydrating render
// keep the plain text; the words are wrapped once mounted.
// 原版 (classic) keeps the plain text throughout so the production rendering is unchanged.
import { useEffect, useState } from "react";
import { isHydrated } from "../../lib/hydration";
import { useSiteStyle } from "../../lib/site-styles";
import { titleWords } from "../../lib/title-words";

const SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
export function WordTitle({ children }: { children: string }) {
  const style = useSiteStyle();
  const [ready, setReady] = useState(isHydrated);
  useEffect(() => setReady(true), []);
  if (style === "classic" || !ready || !SEGMENTER) return children;
  return children.split(/([（(“《][^）)”》]{1,10}[）)”》])/).map((part, i) => {
    if (i % 2) return <span className="title-word" key={i}>{part}</span>;
    return titleWords(part, SEGMENTER).map((w, j) => w.keep ? <span className="title-word" key={`${i}-${j}`}>{w.text}</span> : w.text);
  });
}
