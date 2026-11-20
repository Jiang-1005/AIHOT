const LEADING_AUDIT_PATTERNS: RegExp[] = [
  /^(?:原帖(?:链接|地址|页面)?\s*(?:[：:]\s*)?(?:https?:\/\/\S+\s*)?[^。\n]{0,40}?(?:已打开原帖全文|核对(?:通过|完成|原文|无误)?|未查到原文|原文(?:无法|打不)开|未打开原帖)[^。\n]*)[。；;\s]*/,
  /^(?:(?:核验|核对|抓取|收录|校验|溯源)(?:状态|说明|记录|结果)?[：:][^。\n]+)[。；;\s]*/,
  /^(?:(?:已打开原帖全文|已核对原帖全文|已核实原文|已核对原文|未打开原帖核对|核对原文无误))[，,、；;：:\s]*/,
  /^(?:原帖\s*[：:]\s*)?https?:\/\/\S+[，,。；;\s]*/,
];

/**
 * Splits leading crawler/verification provenance boilerplate out of a voice summary
 * so cards show reader-facing content while modals can still inspect the audit trail.
 */
export function splitVoiceProvenance(raw: string): { summary: string; auditNote: string | null } {
  const original = raw.trim();
  if (!original) return { summary: "", auditNote: null };

  let rest = original;
  const notes: string[] = [];

  for (let i = 0; i < 4; i++) {
    let matched = false;
    for (const pattern of LEADING_AUDIT_PATTERNS) {
      const m = rest.match(pattern);
      if (m && m[0].trim()) {
        notes.push(m[0].trim().replace(/[，,、。；;：:\s]+$/, ""));
        rest = rest.slice(m[0].length).trimStart();
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  if (!rest || notes.length === 0) {
    return { summary: original, auditNote: null };
  }

  return {
    summary: rest,
    auditNote: notes.join("；"),
  };
}
