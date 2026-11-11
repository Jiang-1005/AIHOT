// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 */
export const CATEGORIES = [
  { key: "ai-models", tagColor: "indigo", label: "能力", feedLabel: "学习模型与能力", section: "学习能力更新", guide: "面向学习场景的模型、语音、写作或口语能力本身的发布、版本、开放与价格变化。教育产品里的具体功能更新归产品，不归这一类。" },
  { key: "ai-products", tagColor: "turquoise", label: "产品", feedLabel: "AI 教育产品", section: "产品发布/更新", guide: "可使用的 AI 教育产品、功能、学习机、词典笔、伴学应用、口语/表达练习、作文批改、绘本或动画奖励层的发布更新。" },
  { key: "industry", tagColor: "orange", label: "行业", feedLabel: "行业动态", section: "行业动态", guide: "已发生的教育公司经营、融资并购、人事、合作、诉讼，以及教培/素质教育市场的真实事件。政策正式发布归政策类。" },
  { key: "paper", tagColor: "violet", label: "研究", feedLabel: "研究与报告", section: "研究与报告", guide: "以学习效果、教育方法、测评或儿童发展为核心的论文、技术报告、新基准或调研数据集。" },
  { key: "tip", tagColor: "green", label: "实践", section: "实践与观点", guide: "老师、家长或产品团队可以照着做的教学方法、提示词、课堂用法和复盘。单纯发布工具归产品，只有态度而无做法归观点。", commentary: true },
  { key: "opinion", tagColor: "purple", label: "观点", section: "实践与观点", guide: "作者对 AI 教育、大语文、素质教育、双减或未成年人保护的解释、判断、主张、预测、评论或访谈。讨论市场不自动归行业。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布：AI 教育产品更新。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "ai-products", tag: "产品更新", unit: "个产品动态" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["ai", "api", "llm", "k12", "omo", "sel", "ceo", "ipo"];

/**
 * 内容理解一步给每篇资料判的“内容类型”。
 */
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "产品更新", "模型发布", "论文/研究", "教程/实践", "观点观察", "评测/基准", "行业动态", "政策/监管",
  "大语文/表达", "儿童SEL", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "大语文", "阅读写作", "表达口语", "AI老师", "伴学", "儿童SEL", "素质教育", "情商语文",
  "双减", "未成年人保护", "学习机", "家校协同", "口语陪练", "作文批改",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = [
  "作业帮", "猿辅导", "学而思", "有道", "讯飞", "豆神", "斑马", "叫叫", "豆包爱学",
  "Khan Academy", "Duolingo", "Speak", "Ello", "OpenAI", "Google", "Microsoft", "Anthropic", "心田花开",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "教程/玩法": "教程/实践", "技巧/最佳实践": "教程/实践", "合作/生态": "行业动态", "融资/收购": "行业动态", "公司动态": "行业动态",
  合作: "行业动态", 生态: "行业动态", 融资: "行业动态", 收购: "行业动态", 投资: "行业动态", 并购: "行业动态",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 双减: "政策/监管",
  论文: "论文/研究", 研究: "论文/研究", paper: "论文/研究", papers: "论文/研究",
  教程: "教程/实践", 指南: "教程/实践", 技巧: "教程/实践", 实践: "教程/实践",
  产品: "产品更新", 更新: "产品更新", 发布: "产品更新", 模型: "模型发布",
  观点: "观点观察", 趋势: "观点观察",
  作文: "作文批改", 写作: "阅读写作", 口语: "表达口语", 表达: "表达口语",
  情商: "情商语文", 语文: "大语文", "社会情感": "儿童SEL", SEL: "儿童SEL",
  行业: "行业动态", 动态: "行业动态",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  zuoyebang: { name: "作业帮", displayTag: "作业帮", aliases: ["作业帮", "ZYBANG"], orgNames: ["作业帮"] },
  yuanfudao: { name: "猿辅导", displayTag: "猿辅导", aliases: ["猿辅导", "小猿", "猿力科技"], orgNames: ["猿辅导", "小猿"], otherNames: ["小猿口算", "小猿搜题"] },
  xueersi: { name: "学而思 / 好未来", displayTag: "学而思", aliases: ["学而思", "好未来", "TAL"], orgNames: ["学而思", "好未来", "TAL Education"] },
  youdao: { name: "网易有道", displayTag: "有道", aliases: ["有道", "网易有道"], orgNames: ["网易有道", "有道"] },
  iflytek: { name: "科大讯飞", displayTag: "讯飞", aliases: ["讯飞", "科大讯飞", "iFlytek"], orgNames: ["科大讯飞", "讯飞"] },
  dougod: { name: "豆神教育", displayTag: "豆神", aliases: ["豆神", "豆神教育"], orgNames: ["豆神教育", "豆神"] },
  bmma: { name: "斑马", displayTag: "斑马", aliases: ["斑马", "斑马AI课", "掌门"], orgNames: ["斑马"] },
  jiaojao: { name: "叫叫", displayTag: "叫叫", aliases: ["叫叫", "叫叫阅读"], orgNames: ["叫叫"] },
  doubao: { name: "豆包爱学", displayTag: "豆包爱学", aliases: ["豆包爱学", "豆包", "字节跳动"], orgNames: ["豆包", "字节跳动", "ByteDance"], otherNames: ["抖音"] },
  khan: { name: "Khan Academy", displayTag: "Khan Academy", aliases: ["Khan Academy", "Khanmigo", "可汗学院"], orgNames: ["Khan Academy", "可汗学院"], otherNames: ["Khanmigo"] },
  duolingo: { name: "Duolingo", displayTag: "Duolingo", aliases: ["Duolingo", "多邻国"], orgNames: ["Duolingo", "多邻国"] },
  speak: { name: "Speak", displayTag: "Speak", aliases: ["Speak"], orgNames: ["Speak"] },
  ello: { name: "Ello", displayTag: "Ello", aliases: ["Ello"], orgNames: ["Ello"] },
  huakai: { name: "心田花开", displayTag: "心田花开", aliases: ["心田花开", "花啦啦"], orgNames: ["心田花开"], otherNames: ["花啦啦在线"] },
  openai: { name: "OpenAI", displayTag: "OpenAI", aliases: ["OpenAI", "ChatGPT", "Sora"], orgNames: ["OpenAI"], otherNames: ["Study Mode"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "DeepMind", "Gemini", "谷歌", "Khanmigo"], orgNames: ["Google", "Google DeepMind", "谷歌"], otherNames: ["Guided Learning", "Google Classroom"] },
  anthropic: { name: "Anthropic", displayTag: "Anthropic", aliases: ["Anthropic", "Claude"], orgNames: ["Anthropic"] },
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Copilot"], orgNames: ["Microsoft", "微软"] },
};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "zuoyebang", name: "作业帮", patterns: [/作业帮/i] },
  { id: "yuanfudao", name: "猿辅导", patterns: [/猿辅导|小猿搜题|小猿口算|\bYuanfudao\b/i] },
  { id: "xueersi", name: "学而思 / 好未来", patterns: [/学而思|好未来|\bTAL\b/i] },
  { id: "youdao", name: "网易有道", patterns: [/有道|Youdao/i] },
  { id: "iflytek", name: "科大讯飞", patterns: [/讯飞|iFlytek|科大讯飞/i] },
  { id: "dougod", name: "豆神", patterns: [/豆神/i] },
  { id: "bmma", name: "斑马", patterns: [/斑马AI|斑马课|\b斑马\b/i] },
  { id: "jiaojao", name: "叫叫", patterns: [/叫叫/i] },
  { id: "doubao", name: "豆包爱学", patterns: [/豆包爱学|豆包|\bDoubao\b|字节跳动|ByteDance/i] },
  { id: "khan", name: "Khan Academy", patterns: [/Khan\s?Academy|Khanmigo|可汗学院/i] },
  { id: "duolingo", name: "Duolingo", patterns: [/Duolingo|多邻国/i] },
  { id: "speak", name: "Speak", patterns: [/\bSpeak\b/] },
  { id: "ello", name: "Ello", patterns: [/\bEllo\b/] },
  { id: "huakai", name: "心田花开", patterns: [/心田花开|花啦啦/i] },
  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|谷歌|Classroom|Guided Learning/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i] },
  { id: "microsoft", name: "Microsoft / Copilot", patterns: [/microsoft|copilot|微软/i] },
];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "khan", domains: ["khanacademy.org", "blog.khanacademy.org"] },
  { entityId: "duolingo", domains: ["duolingo.com", "blog.duolingo.com"] },
  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "google", domains: ["blog.google", "edu.google.com"] },
  { entityId: "microsoft", domains: ["microsoft.com", "educationblog.microsoft.com"] },
];

export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "google", pattern: /Guided Learning|Google Classroom/i },
  { entityId: "khan", pattern: /Khanmigo/i },
  { entityId: "openai", pattern: /Study Mode|ChatGPT Edu/i },
];
