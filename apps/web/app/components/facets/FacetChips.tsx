import { useMemo, useState, type ReactNode } from "react";

export const FACET_LABELS = {
  topic: "主题",
  subject: "学科能力",
  form: "形态",
  content_type: "内容类型",
  company: "公司与产品",
} as const;

export type FacetKey = keyof typeof FACET_LABELS;

export type FacetState = {
  topic: string[];
  subject: string[];
  form: string[];
  content_type: string[];
  company: string[];
};

export const EMPTY_FACETS: FacetState = { topic: [], subject: [], form: [], content_type: [], company: [] };

export type FacetsMeta = {
  vocab: FacetVocab;
  headCompanies: string[];
  logos: { index: LogoIndex; missing?: string[] };
  counts: Partial<Record<FacetKey, Record<string, number>>>;
};

export function facetsFromRecord(f: { topic?: string[]; subject?: string[]; form?: string[]; content_type?: string[]; company?: string[] } | undefined): FacetState {
  return {
    topic: [...(f?.topic ?? [])],
    subject: [...(f?.subject ?? [])],
    form: [...(f?.form ?? [])],
    content_type: [...(f?.content_type ?? [])],
    company: [...(f?.company ?? [])],
  };
}

export type FacetVocab = {
  topic: string[];
  subject: string[];
  form: string[];
  content_type: string[];
};

export type LogoIndex = Record<string, string>;

const HEAD_DEFAULT = [
  "好未来", "学而思", "新东方", "猿辅导", "作业帮", "有道", "讯飞", "高途", "豆神", "洋葱学园", "叫叫",
  "Duolingo（多邻国）", "Khan Academy", "Chegg", "Quizlet", "Speak",
];

export function facetsEqualEmpty(f: FacetState): boolean {
  return !f.topic.length && !f.subject.length && !f.form.length && !f.content_type.length && !f.company.length;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function chipClass(on: boolean): string {
  return `inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-none transition-colors ${
    on ? "bg-ink text-white" : "bg-bg-sunk text-ink-2 hover:text-ink"
  }`;
}

export function LogoMark({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  const ch = name.trim().charAt(0) || "?";
  const fallback = (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-bg-muted text-[10px] font-semibold text-ink-3">
      {ch}
    </span>
  );
  if (!src || broken) return fallback;
  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className="size-4 shrink-0 rounded-[3px] object-contain"
      onError={() => setBroken(true)}
    />
  );
}

export function logoFor(name: string, index: LogoIndex): string | undefined {
  const aliases: Record<string, string[]> = {
    有道: ["网易有道", "有道"],
    讯飞: ["科大讯飞", "讯飞"],
    豆神: ["豆神教育", "豆神"],
    "Khan Academy": ["Khan Academy", "Khan", "可汗学院"],
    Duolingo: ["Duolingo", "多邻国", "Duolingo（多邻国）"],
    "Duolingo（多邻国）": ["Duolingo", "多邻国", "Duolingo（多邻国）"],
    "字节跳动": ["字节跳动", "豆包"],
  };
  const parts = name.split(/\s*[›>／/]\s*/).map((s) => s.trim()).filter(Boolean);
  const keys = [name, ...parts];
  if (parts.length > 1) keys.push(parts.join(" "), `${parts[0]} ${parts.slice(1).join(" ")}`);
  for (const key of keys) {
    if (index[key]) return index[key];
    for (const [k, vals] of Object.entries(aliases)) {
      if (key === k || vals.includes(key)) {
        for (const v of [k, ...vals]) if (index[v]) return index[v];
      }
    }
  }
  return undefined;
}

export function companyChipName(token: string): string | null {
  if (!token || ["不涉及", "未查到", "待定", "小红书", "X", "Twitter", "x.com"].includes(token)) return null;
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(token) && !/[›>/]/.test(token)) return null;
  const parts = token.split(/\s*[›>／/]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const display: Record<string, string> = { 网易有道: "有道", 科大讯飞: "讯飞", 豆神教育: "豆神", Khan: "Khan Academy", Duolingo: "Duolingo（多邻国）", 多邻国: "Duolingo（多邻国）" };
  const company = display[parts[0]!] ?? parts[0]!;
  const product = parts[1];
  if (product && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(product)) return company;
  if (product) return `${company} › ${product}`;
  return company;
}

type CompanyOpt = { name: string; count: number };

export function buildCompanyRow(counts: Record<string, number>, head: string[], maxVisible = 8): { visible: CompanyOpt[]; more: CompanyOpt[] } {
  const withItems = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .map(([name, count]) => ({ name, count }));
  const visible = withItems.slice(0, maxVisible);
  const shown = new Set(visible.map((c) => c.name));
  const moreFromItems = withItems.slice(maxVisible);
  const headRest = head.filter((h) => !shown.has(h)).map((name) => ({ name, count: counts[name] ?? 0 }));
  const moreNames = new Set(moreFromItems.map((c) => c.name));
  const more = [...moreFromItems, ...headRest.filter((h) => !moreNames.has(h.name))];
  return { visible, more };
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 pt-1 text-[12px] font-medium text-ink-4">{label}</div>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function SelectedFacetBars({
  value,
  identity,
  onToggle,
  onClearIdentity,
  onClearAll,
}: {
  value: FacetState;
  identity?: { label: string; onClear: () => void } | null;
  onToggle: (key: FacetKey, name: string) => void;
  onClearIdentity?: () => void;
  onClearAll: () => void;
}) {
  const pills: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (identity) pills.push({ key: "id", label: identity.label, onRemove: identity.onClear });
  (Object.keys(FACET_LABELS) as FacetKey[]).forEach((k) => {
    for (const name of value[k]) {
      pills.push({ key: `${k}-${name}`, label: name, onRemove: () => onToggle(k, name) });
    }
  });
  if (!pills.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((p) => (
        <button key={p.key} type="button" onClick={p.onRemove} className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[12px] text-white">
          {p.label}
          <span aria-hidden="true" className="text-[11px] opacity-70">×</span>
        </button>
      ))}
      <button type="button" onClick={onClearAll} className="text-[12px] text-accent hover:underline">
        清空
      </button>
    </div>
  );
}

export function FacetChipRows({
  vocab,
  value,
  onChange,
  counts,
  logos,
  headCompanies,
  extraRows,
}: {
  vocab: FacetVocab;
  value: FacetState;
  onChange: (next: FacetState) => void;
  counts?: Partial<Record<FacetKey, Record<string, number>>>;
  logos?: LogoIndex;
  headCompanies?: string[];
  extraRows?: ReactNode;
}) {
  const [showMore, setShowMore] = useState(false);
  const logoIndex = logos ?? {};
  const companies = useMemo(
    () => buildCompanyRow(counts?.company ?? {}, headCompanies ?? HEAD_DEFAULT),
    [counts?.company, headCompanies],
  );
  const setKey = (key: FacetKey, name: string) => onChange({ ...value, [key]: toggle(value[key], name) });
  const companyList = showMore ? [...companies.visible, ...companies.more] : companies.visible;

  return (
    <div className="space-y-2.5">
      {extraRows}
      <FilterRow label="主题">
        {vocab.topic.map((v) => (
          <button type="button" key={v} className={chipClass(value.topic.includes(v))} onClick={() => setKey("topic", v)}>{v}</button>
        ))}
      </FilterRow>
      <FilterRow label="学科能力">
        {vocab.subject.map((v) => (
          <button type="button" key={v} className={chipClass(value.subject.includes(v))} onClick={() => setKey("subject", v)}>{v}</button>
        ))}
      </FilterRow>
      <FilterRow label="公司与产品">
        {companyList.map((c) => (
          <button type="button" key={c.name} className={chipClass(value.company.includes(c.name))} onClick={() => setKey("company", c.name)}>
            <LogoMark name={c.name} src={logoFor(c.name, logoIndex)} />
            {c.name}
          </button>
        ))}
        {companies.more.length > 0 && (
          <button type="button" className={chipClass(showMore)} onClick={() => setShowMore((s) => !s)}>
            {showMore ? "收起" : "更多"}
          </button>
        )}
      </FilterRow>
      <FilterRow label="形态">
        {vocab.form.map((v) => (
          <button type="button" key={v} className={chipClass(value.form.includes(v))} onClick={() => setKey("form", v)}>{v}</button>
        ))}
      </FilterRow>
      <FilterRow label="内容类型">
        {vocab.content_type.map((v) => (
          <button type="button" key={v} className={chipClass(value.content_type.includes(v))} onClick={() => setKey("content_type", v)}>{v}</button>
        ))}
      </FilterRow>
    </div>
  );
}

export { FilterRow, chipClass, toggle };
