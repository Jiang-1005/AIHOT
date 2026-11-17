# 教育AIHOT 设计硬性规范（草稿）

- 范围：只写可测的硬性要求——中文排版、对比度、多主题/深色 token、减弱动效、首屏性能。视觉风格、十套主题的创意和审美不在本文，也不用站点案例来定规则。
- 用法：每条都是「规则｜数值｜出处｜AIHOT 怎么验收」。数字都来自一手文档，并在北京时间 2026-11-17 打开核对。查不到的不编。
- 适用：十套风格（晨报、控制台、微动、苹果、杂志、瑞士、水彩、包豪斯、暗房、毛玻璃）以及各自的浅色/深色，都必须通过文末验收清单。
- 本文不是上线许可，是验收底线。

核对过的一手出处（版本以打开时页面为准）：

| 出处 | 打开的地址 | 打开时状态 |
| --- | --- | --- |
| W3C 《中文排版需求》 | https://www.w3.org/TR/clreq/ | Group Note Draft，2026-11-04 |
| WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | W3C Recommendation，2024-12-12 |
| WCAG 3.0 | https://www.w3.org/TR/wcag-3.0/ | Working Draft，2026-09-10 |
| CSS Media Queries Level 5 | https://www.w3.org/TR/mediaqueries-5/ | Working Draft，2026-02-19 |
| web.dev Core Web Vitals | https://web.dev/articles/vitals | 页面标注更新至 2024-10-31 |
| web.dev 定义阈值 | https://web.dev/articles/defining-core-web-vitals-thresholds | 已打开 |
| web.dev 优化 CLS / 字体 | https://web.dev/articles/optimize-cls 、 https://web.dev/articles/font-best-practices 、 https://web.dev/articles/reduce-webfont-size | CLS 文标注更新至 2025-02-07 |
| web.dev 深色模式 | https://web.dev/articles/prefers-color-scheme 、 https://web.dev/articles/color-scheme | 已打开 |
| Material 3 动效与 token | https://m3.material.io/styles/motion/easing-and-duration/tokens-specs 、 https://m3.material.io/styles/motion/easing-and-duration 、 https://m3.material.io/foundations/design-tokens/overview | 已打开；页面注明 easing/duration 体系仍用于转场，物理弹簧体系为更新方向 |
| Apple HIG | https://developer.apple.com/design/human-interface-guidelines/motion.md 、 …/accessibility.md 、 …/dark-mode.md | 已打开 Markdown 原文（HTML 版需 JS，改用官方 md） |
| Chrome 同源转场指南 | https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/same-document-transitions | 已打开 |

---

## 1. 中文排版

依据是 clreq。它是 W3C Group Note 草案，不是 Recommendation，但是目前中文排版的一手需求文档。网页实现可以用 CSS（如 `text-autospace`、`text-spacing-trim`、`hanging-punctuation`），验收以是否满足下面的 clreq 要求为准，不以某个 CSS 属性是否写上为准。

### 1.1 行长

- **规则：** 行长按字体、版心、媒介实际设置。报纸期刊相对短、书籍相对长。为避免频繁换行或串行，正文有上下限。行长应为字号的整数倍，除段落末行外，行首行尾对齐。汉字密排，字框原则上是正方形。
- **数值：** 多数书籍正文行长参考值 17–40 字；最小不宜少于 10 字；横排最大不宜超过 48 字，竖排不宜超过 55 字。
- **出处：** https://www.w3.org/TR/clreq/#considerations_in_designing_type_area （7.1.1.5）；行长作为版心要素见 https://www.w3.org/TR/clreq/#designing_elements_of_type_area （7.1.1.2）。
- **AIHOT 怎么验收：** 在阅读页和日报正文，用「容器内容宽度 ÷ 汉字字号」计算每行字数。桌面（视口 ≥ 1024px）横排正文一行不超过 48 个汉字，目标落在 17–40 字。320px 宽下不少于 10 字（可接受折行，但不能把字号加到一行不足 10 字）。卡片标题和芯片不套这条行长上限。站点以横排为准，不验收竖排 55 字。

### 1.2 行距（行隙）

- **规则：** 行距全篇保持一致，不要为了某一行的行间标点把单行局部撑高。需要放置行间标点（着重号、专名号、书名号浪线等）时，行距有下限。clreq 的「行距 / line gap」指行与行之间的空隙，不是 CSS `line-height`。换算关系：`line-height` ≈ 1 + 行距/字号。
- **数值：** 单面装行距不应小于当前字号的 1/2；双面装不应小于当前字号的 5/8（= 1/2 + 1/8）。对应 CSS：单面 `line-height` ≥ 1.5，双面 ≥ 1.625。直排且注音在基字右侧时，段落行距通常需要基字尺寸 1.5 倍以上（AIHOT 正文不用注音，仅作对照）。
- **出处：** 行间标点下限见 clreq 处理行间标点一节（打开全文后核对原文「单面装的行距不应小于当前字号的一半、双面装……5/8」）；注音行距见 https://www.w3.org/TR/clreq/#h-line_prohibition_rules_for_zhuyin 。
- **AIHOT 怎么验收：** 阅读页、日报、卡片正文的 `line-height` 计算值 ≥ 1.5，同一段落内各行行高一致。没有行间标点时，不把 1.7 或其他习惯值写成 clreq 硬性要求。抽查计算样式，不要目测。

### 1.3 字号

- **规则：** 字号按文字外框测量。传统「号」与点的换算表只供参考，不是规范性规定。一般内文常用五号，报纸杂志也常用新五号；小于六号则因汉字结构复杂较难阅读。网页还必须让用户能把文字放大到 200% 且不丢功能。
- **数值：** 五号 ≈ 10.5 pt（约 3.7 mm）；新五号 ≈ 9 pt（约 3.2 mm）；最小六号 ≈ 7.875 pt（约 2.8 mm）。在 CSS 参考分辨率 96 px/in 下，10.5 pt ≈ 14 px。WCAG 2.2 成功标准 1.4.4：除字幕和文字图像外，文字可在不使用辅助技术的情况下放大到 200%，不丢失内容和功能。
- **出处：** https://www.w3.org/TR/clreq/#considerations_in_designing_type_area ；https://www.w3.org/TR/WCAG22/#resize-text 。
- **AIHOT 怎么验收：** 正文使用 `rem` 等相对单位，不用把正文锁死在无法缩放的 `px` 上。浏览器默认 100% 时，阅读页正文计算字号不小于 14 px（由五号 10.5 pt 换算，不是另一条独立标准）。将页面缩放到 200%，首页筛选、卡片标题、阅读页正文仍可读、可点、不被裁切或互相重叠。WCAG 没有把「网页正文必须 16 px」写成成功标准，验收不以 16 px 为 W3C 门槛。

### 1.4 标点挤压

- **规则：** 标点通常占 1 em，可调整的标点在相邻或位于行首行尾时应收紧，让版面更紧凑、更易读。挤压方向应让开闭夹注符号紧靠被夹注的内容。
- **数值：** 任意两个相邻标点若共占 2 个字宽，原则上应缩成 1.5 个字宽；在此原则上，允许某种风格进一步缩到 1 个字宽。行首出现开始夹注符号时，可以缩减该符号始侧 1/2 个汉字宽；段首缩进时同样适用。部分标点宽度固定、不可调（如大陆 GB 式半字连接号、间隔号、分隔号固定 1/2 em；港台横排问号、感叹号等固定 1 em）。
- **出处：** https://www.w3.org/TR/clreq/#punctuation_width_adjustment （6.3.2）；相邻调整 https://www.w3.org/TR/clreq/#h-adjustment_of_adjacent_punctuation_marks （6.3.2.2）；行首行尾 https://www.w3.org/TR/clreq/#h-compression_of_punctuation_marks_at_line_start （6.3.2.3）。
- **AIHOT 怎么验收：** 在阅读页用包含「（《」、」）」、」，」等组合的真实句子截图或量盒。两个相邻各 1 em 的夹注/点号，合计占用宽度应 ≤ 1.5 em（允许到 1 em）。行首「（」「《」等开括号，其前侧不应再留出整整半个字的空档。关闭挤压或浏览器不支持时，在验收记录里写明「未实现」，不能宣称已符合 clreq。

### 1.5 行尾点号悬挂

- **规则：** 绝大多数中文出版物没有悬挂行尾点号的惯例。若采用，它是行首禁则的延伸，避免点号被挤到下一行行首、造成前行字距不匀。行尾通常只挂一个点号。连续标点时不应悬挂。港台点号居中，横排悬挂会显得突兀，故横排通常不做，直排可用。简体点号偏字面始端，顿号、逗号、句号适合悬挂，其余点号也可以挂。
- **数值：** 行尾最多悬挂 1 个点号；适合悬挂的至少包括顿号、逗号、句号。
- **出处：** https://www.w3.org/TR/clreq/#hanging_punctuation_marks_at_line_end （6.1.3）。
- **AIHOT 怎么验收：** 悬挂不是强制项。若某套风格开启悬挂：用会在行首出现「，」「。」的句子检查，点号应留在上一行行尾并最多突出 1 个字宽，且连续标点不悬挂。未开启则本条记「不适用」，不扣十套通关项。

### 1.6 中西文混排间距

- **规则：** 横排时，西文字母用比例字体，阿拉伯数字用比例或等宽字体。汉字与西文字母、数字之间，原则上使用不多于 1/4 个汉字宽的字距或空白；西文或数字出现在行首或行尾时不加这段空白。中文点号前后、中文开始夹注符号之后、结束夹注符号之前的西文或数字，不调整字距、不加空白。也可以改用西文词间空格（U+0020），宽度随字体变化。汉字本身密排。
- **数值：** 中西间距 ≤ 1/4 em；行首、行尾为 0；点号和夹注符号内侧为 0。
- **出处：** https://www.w3.org/TR/clreq/#mixed_text_composition_in_horizontal_writing_mode （6.3.3）。直排比例字体旋转时的同等上限见 https://www.w3.org/TR/clreq/#mixed_text_composition_in_vertical_writing_mode （2.3 节相关）。
- **AIHOT 怎么验收：** 抽检「Khan Academy（可汗学院）」「ChatGPT 3」「OECD 报告」等真实写法。汉字与相邻拉丁字母或数字之间的空隙 ≤ 0.25 em（可用计算样式或量盒），且「（可汗」这类夹注内侧没有额外空隙。不要用全角空格硬插出半个字以上的洞。

### 1.7 段首缩进

- **规则：** 段首缩进原则上以汉字大小的整数倍为单位。中文出版物以两个汉字为标准；多栏且每栏字数较少时，可用一字，以免两字显得突兀。也可以所有段落都不缩进，改用段间距来区分。不要把「不缩进 + 段间空行」理解成必须再加空行当分节——clreq 对书籍段间空行另有说明。
- **数值：** 标准段首缩进 2 em；窄栏可用 1 em。
- **出处：** https://www.w3.org/TR/clreq/#first_line_indents （6.2.1.1）。
- **AIHOT 怎么验收：** 阅读页和日报正文的段落区隔只能选一种主方式：段首 2 em（窄栏 1 em），或段间距。抽查计算样式，两种不要叠成过大空白。卡片摘要、芯片、刊头不套这条。

### 1.8 中文网页字体加载

- **规则：** `@font-face` 本身不会下载字体，只有页面样式真正用到该字体才会请求。关键字体声明宜放在文档 `<head>` 的关键 CSS 里，以便尽早发现；不要把字体文件本身内联进 HTML。用子集化（subset）和 `unicode-range` 减小字包。`font-display` 决定不可见等待和换字时机，会影响 LCP/FCP 和 CLS。`auto`/`block`/`swap`/`fallback` 都可能在换字时造成布局偏移；`optional` 最多阻塞约 100 ms，且过时不换字，因而没有换字引起的 CLS。正文与品牌标题可以采用不同策略。用 `size-adjust`、`ascent-override`、`descent-override`、`line-gap-override` 让回退字体与正式字体的度量接近。
- **数值：** `font-display` 时间窗（web.dev 字体最佳实践表）：`swap` 阻塞 0、交换期无限；`fallback` 阻塞 100 ms、交换期 3 s；`optional` 阻塞 100 ms、无交换期；`block` 阻塞约 2–3 s、交换期无限。
- **出处：** https://web.dev/articles/font-best-practices ；子集化 https://web.dev/articles/reduce-webfont-size ；换字与 CLS https://web.dev/articles/optimize-cls （Web fonts 一节）。
- **AIHOT 怎么验收：** 网络面板中，中文字体为 WOFF2，并按 `unicode-range` 或构建时子集拆包，不得把完整超大 CJK 字库作为首屏唯一请求。正文 `font-display` 为 `optional` 或 `fallback`；若标题用 `swap`，必须同时配置度量修正或预加载，使换字引起的 CLS 不把页面推出 0.1 门槛。未设置回退字体族的视为未通过。DevTools 禁用缓存硬刷新，确认正文不会长时间不可见（避免 `block` 作为正文策略）。

---

## 2. 配色与对比度

### 2.1 正文与大字对比度（WCAG 2.2 AA）

- **规则：** 文本和文字图像的对比度至少为 4.5:1。大字（large-scale）至少 3:1。非活动控件、纯装饰、不可见、或图片中带有其他重要视觉内容的文字，以及标志、品牌名中的文字，没有这项要求。对比度公式为 (L1 + 0.05) / (L2 + 0.05)，L1、L2 为较亮和较暗颜色的相对亮度。
- **数值：** 普通文本 ≥ 4.5:1；大字 ≥ 3:1。大字定义为至少 18 point，或 14 point 粗体，或对中日韩字体达到等效大小。对许多主流正文字体，14/18 point 大约相当于 1.2/1.5 em，或默认正文字号的 120%/150%，但必须按实际字体核对。字号按交付时的尺寸计算，不包括用户事后缩放。
- **出处：** 成功标准 1.4.3 https://www.w3.org/TR/WCAG22/#contrast-minimum ；术语「large scale (text)」https://www.w3.org/TR/WCAG22/#dfn-large-scale 。AAA 增强值（7:1 / 大字 4.5:1）见 1.4.6 https://www.w3.org/TR/WCAG22/#contrast-enhanced ，本文不作强制，仅作可选加严。
- **AIHOT 怎么验收：** 用对比度工具（或浏览器无障碍检查）测量每一套风格的浅色和深色：阅读页正文、次要说明、「数据截至」、芯片未选中标签、卡片摘要。普通文本必须 ≥ 4.5:1。只有达到大字定义的标题才允许降到 ≥ 3:1。半透明文字按渲染后的实际颜色测，不要按原始色值估。

### 2.2 非文本对比度

- **规则：** 用来辨认用户界面组件及其状态的视觉信息，以及理解内容所必需的图形部分，与相邻颜色的对比度至少为 3:1。非活动组件、或外观完全由用户代理决定且作者未改的组件除外；若某种图形表现对传达信息是必需的，也可例外。
- **数值：** ≥ 3:1。
- **出处：** 成功标准 1.4.11 https://www.w3.org/TR/WCAG22/#non-text-contrast 。
- **AIHOT 怎么验收：** 检查五维芯片的描边或填充边界、选中态与未选中态的可分辨差异、焦点环、关闭按钮、图标按钮、开关。上述与相邻背景的对比度 ≥ 3:1。不能只靠颜色区分选中态（若色差不足 3:1，必须加描边、勾选或其他形状变化）。

### 2.3 APCA 只作参考，不是门槛

- **规则：** 当前必须满足的是 WCAG 2.2 的对比度成功标准。WCAG 3.0 仍是工作草案，编辑说明写明「WCAG 3 使用的对比度算法尚未确定（yet to be determined）」。因此 APCA 不能代替 2.2，也不能写成十套风格的通关条件。若团队额外用 APCA 做抽查，结果只作参考，且不得放松 2.2 已经要求的比值。
- **数值：** 无 WCAG 3 官方对比度阈值可引用（2026-09-10 草案仍写算法待定）。
- **出处：** https://www.w3.org/TR/wcag-3.0/ （Working Draft，2026-09-10）中「Text contrast sufficient (minimum)」的 Editor's note。
- **AIHOT 怎么验收：** 验收报告只把 WCAG 2.2 的 4.5:1 / 3:1 / 非文本 3:1 列为通过/不通过。若附 APCA 读数，必须标明「非本规范门槛」。

---

## 3. 多主题与深色模式 token

### 3.1 跟随系统浅色/深色，并声明 `color-scheme`

- **规则：** 用 `prefers-color-scheme` 探测用户希望浅色还是深色。`light` 表示用户希望浅色背景上的深色文字等；`dark` 相反。页面再用 CSS 属性或同名 meta 声明 `color-scheme`，让滚动条、表单控件和系统色跟随主题，并避免浏览器擅自做额外变换。
- **数值：** 媒体特性取值为 `light | dark`（另有 `no-preference` 等上下文，以规范为准）。`color-scheme` 常见声明为 `light dark`，表示两种都支持。
- **出处：** https://www.w3.org/TR/mediaqueries-5/#prefers-color-scheme ；https://web.dev/articles/prefers-color-scheme ；https://web.dev/articles/color-scheme 。Apple HIG Dark Mode（https://developer.apple.com/design/human-interface-guidelines/dark-mode.md ）要求界面在两种外观下都可用，并默认尊重系统偏好。
- **AIHOT 怎么验收：** 文档 `<head>` 含 `<meta name="color-scheme" content="light dark">`（或等价 CSS `:root { color-scheme: light dark; }`）。操作系统切到深色/浅色后，在用户没有手动覆盖时，首屏背景和正文随系统变化。十套风格每套都要有浅色和深色（或明确复用同一套深色 token），不能只有浅色。

### 3.2 无错误主题闪白

- **规则：** 关键主题 CSS 必须在首次绘制前生效。web.dev 写明：可用客户端提示 `Sec-CH-Prefers-Color-Scheme` 在请求时得知偏好，从而内联正确 CSS，避免 flash of incorrect color theme；加载策略上，不要在关键渲染路径里强迫用户下载当前用不到的那一套主题 CSS。
- **数值：** 无固定毫秒阈值。验收标准是首次绘制的背景/正文已经是正确主题，而不是先闪一套再换成另一套。
- **出处：** https://web.dev/articles/prefers-color-scheme （「Learning about a user's preferences at request time」与 Loading strategy）。
- **AIHOT 怎么验收：** 清空缓存后硬刷新浅色和深色两种系统设置，用录像或 Performance 面板看首次绘制。不允许先出现白底黑字再跳到深色（或相反）。若提供「强制浅色/深色」覆盖，覆盖逻辑必须放在首屏绘制之前（例如 `<head>` 内联脚本），不能等主包执行完再改。

### 3.3 Token 分成参考值、语义角色、组件，不写死色值

- **规则：** 用设计 token，不要在组件里写死十六进制颜色。Material 把 token 分成三类：reference（参考，指向静态色值或字号等，不随上下文改名）、system（系统，表达这个值在界面里的角色，主题和深浅在这里切换）、component（组件，指向系统或参考 token，而不是硬编码）。系统 token 应尽可能指向参考 token，而不是静态值。同一系统 token 在浅色/深色等不同 context 下可以指向不同的参考 token。Apple HIG 要求优先使用会随外观变化的语义色，自定义色要同时给出亮、暗变体，避免不自适应的硬编码色。
- **数值：** 无数值门槛。结构要求：至少两层（参考色板 / 语义角色），组件只引用语义角色。
- **出处：** https://m3.material.io/foundations/design-tokens/overview ；https://developer.apple.com/design/human-interface-guidelines/dark-mode.md （「Embrace colors that adapt… Avoid using hard-coded color values」）。
- **AIHOT 怎么验收：** 抽查样式源。`--color-bg`、`--color-text`、`--color-border`、`--color-accent`、`--color-chip-bg` 这类语义变量必须存在；十套风格和深浅只替换这些变量的取值，不复制一整份组件 CSS。组件文件（卡片、芯片、刊头、阅读正文）中不应出现与主题绑定的裸 `#rrggbb` 作为正文/背景/边框色。切换风格或深浅时，对比度仍须满足第 2 节。

### 3.4 深色不是简单反相，对比度不能掉

- **规则：** Apple 写明深色色板里的颜色不一定是浅色的反相；两种外观都要保持舒适可读。WCAG 2.2 的对比度在每一种主题、每一种深浅下单独成立。Material 也把 dark theme 当作 token 的一种 context。
- **数值：** 深色模式下正文仍 ≥ 4.5:1，大字 ≥ 3:1，非文本 ≥ 3:1。Apple HIG 另外建议自定义前景/背景尽量达到 7:1，尤其是小字；这是建议，不是本文强制项。
- **出处：** https://developer.apple.com/design/human-interface-guidelines/dark-mode.md ；对比度数值仍以 https://www.w3.org/TR/WCAG22/#contrast-minimum 为准。
- **AIHOT 怎么验收：** 每一套风格的深色都单独跑第 2 节的测量，尤其是「数据截至」、未选中芯片、暗背景上的灰字。禁止只把浅色亮度反相后不重测。

---

## 4. 动效与减弱动效

### 4.1 时长与 easing（可测默认值）

- **规则：** 网页转场采用 Material 3 仍在使用的时长/easing 体系作为可测默认（该页注明物理弹簧是更新方向，但 easing/duration 仍用于 transitions）。短时长用于小范围、工具性变化；中等用于跨过中等区域；长时长用于大范围、需强调的转场。出场应比入场短。Apple HIG 不规定固定毫秒，但要求：动效必须有目的、不能只靠动效传递重要信息、反馈动画要短而精确、频繁出现的界面操作一般不要再加自定义动效、尽量允许用户中途打断、不要让人等动画结束才能继续操作。
- **数值（Material 3，已打开 tokens 页）：**
  - 短：50 / 100 / 150 / 200 ms（`short1`–`short4`）。选择类控件示例为 200 ms + Standard easing。
  - 中：250 / 300 / 350 / 400 ms。
  - 长：450 / 500 / 550 / 600 ms。
  - 超长：700–1000 ms，主要用于与用户输入无关的环境动效，AIHOT 默认不用。
  - 建议搭配（easing-and-duration 页）：Standard 300 ms（在屏内开始并结束）；Standard decelerate 250 ms（入场）；Standard accelerate 200 ms（出场）。强调类：Emphasized 500 ms，Emphasized decelerate 400 ms 入场，Emphasized accelerate 200 ms 出场。
  - CSS 可用曲线：Standard `cubic-bezier(0.2, 0, 0, 1)`；Standard decelerate `cubic-bezier(0, 0, 0, 1)`；Standard accelerate `cubic-bezier(0.3, 0, 1, 1)`；Emphasized decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)`；Emphasized accelerate `cubic-bezier(0.3, 0, 0.8, 0.15)`。Emphasized 本体在 CSS 上写的是 N/A，回退到 Standard。
- **出处：** https://m3.material.io/styles/motion/easing-and-duration/tokens-specs ；https://m3.material.io/styles/motion/easing-and-duration ；https://developer.apple.com/design/human-interface-guidelines/motion.md 。
- **AIHOT 怎么验收：** 芯片选中、悬停、数字变化等小反馈 ≤ 200 ms。筛选后卡片重排、列表替换等中等变化 ≤ 400 ms。主题切换等整页级变化 ≤ 500 ms。测量计算样式或性能面板中的 animation/transition duration，允许 ±50 ms 的实现误差。禁止把 700 ms 以上的装饰循环用在资讯阅读首屏。easing 不得使用线性直线（`linear`）做位移动效，除非减弱动效已关闭位移。

### 4.2 哪些交互可以有动效

- **规则：** 只给能帮助理解状态变化的交互加动效，例如：芯片选中、筛选后列表重排、主题切换、数字变化、加载到真实内容的过渡、页面之间的视图衔接。频繁的日常操作（滚动、移动光标、每张卡片的持续呼吸/炫光）不要叠加自定义运动。重要信息不可以只靠动画表达。
- **数值：** 见 4.1 的时长上限；自动移动、闪烁或滚动若自动开始、持续超过 5 秒、并与其他内容同时呈现，必须提供暂停、停止或隐藏机制（WCAG 2.2 成功标准 2.2.2，A 级）。由交互触发的运动动画应可关闭，除非该动画对功能或信息是必不可少的（成功标准 2.3.3，AAA；作为加严项采用）。
- **出处：** Apple HIG Motion「Add motion purposefully」「In apps, generally avoid adding motion to UI interactions that occur frequently」「Make motion optional」「Let people cancel motion」；https://www.w3.org/TR/WCAG22/#pause-stop-hide ；https://www.w3.org/TR/WCAG22/#animation-from-interactions 。
- **AIHOT 怎么验收：** 列出每一套风格实际包含的动画清单。不在清单里的循环装饰动画一律关掉。若有自动轮播或无限滚动动效，检查是否在 5 秒内出现可暂停控件。键盘和指针操作都要能跳过或不等待动画结束。

### 4.3 `prefers-reduced-motion`

- **规则：** 当用户请求减少非必要运动时，应去掉或替换会引发前庭不适或注意力干扰的运动类动画。Apple 要求在 Reduce Motion 打开时减少自动和重复动画，包括缩放、放大和周边运动；并用淡入淡出替换轴向位移，收紧弹簧、避免模糊进出和 z 轴深度动画。Chrome 同源视图转场指南要求在该媒体查询下关闭 view-transition 动画。
- **数值：** 媒体特性 `prefers-reduced-motion` 的值为 `no-preference | reduce`（https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion ）。`reduce` 时：位移、缩放、旋转、视差、圆形揭示、弹性过冲均关闭（`animation: none` 或等价）；允许即时切色，或不超过 1 ms 的淡变。WCAG 对「motion animation」的定义包括位置、大小、形状的过渡，不包括单纯的颜色、模糊或透明度变化。
- **出处：** https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion ；https://developer.apple.com/design/human-interface-guidelines/accessibility.md ；https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/same-document-transitions （文中的强制示例：

  ```css
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-group(*),
    ::view-transition-old(*),
    ::view-transition-new(*) {
      animation: none !important;
    }
  }
  ```

  ）；术语 https://www.w3.org/TR/WCAG22/#dfn-motion-animation 。
- **AIHOT 怎么验收：** 在系统或 DevTools 中打开「减少动态效果」后，刷新首页、切换五维芯片、切换风格/深浅、进入阅读页。不得再出现卡片平移、主题圆形展开、数字翻滚位移、视差或持续缩放。功能全部保留。源码中必须存在对 `prefers-reduced-motion: reduce` 的处理，且覆盖自定义动画和 View Transitions。

### 4.4 透明与毛玻璃

- **规则：** 若用户请求减少透明或半透明层效果，界面应尽量减少这类效果。这与十套里的「毛玻璃」直接相关：减弱透明时必须改成不透明底，不能只降低一点透明度敷衍。
- **数值：** `prefers-reduced-transparency` 取值为 `no-preference | reduce`。
- **出处：** https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-transparency 。
- **AIHOT 怎么验收：** DevTools 模拟 `prefers-reduced-transparency: reduce` 后，毛玻璃、模糊衬底、半透明叠层改为实底，文字对比度仍满足第 2 节。其他不使用透明效果的风格本条自然通过。

---

## 5. 首屏性能（Core Web Vitals）

### 5.1 三项阈值

- **规则：** 以真实用户 75 分位、并按移动端和桌面分别统计。三个指标都达到「好」才算该页通过。实验室数据（Lighthouse 等）用于开发期回归，不能代替现场数据。Lighthouse 默认无法测 INP（无用户输入），可用 TBT 作为实验室代理。
- **数值：**

  | 指标 | 好 | 差 | 统计 |
  | --- | --- | --- | --- |
  | LCP（最大内容绘制） | ≤ 2.5 s（2500 ms） | > 4.0 s | 75 分位 |
  | INP（交互到下次绘制） | ≤ 200 ms | > 500 ms | 75 分位 |
  | CLS（累积布局偏移） | ≤ 0.1 | > 0.25 | 75 分位 |

- **出处：** https://web.dev/articles/vitals ；https://web.dev/articles/defining-core-web-vitals-thresholds 。
- **AIHOT 怎么验收：** 实验室用 Lighthouse 或本地 Performance 测首页、筛选后列表、阅读页（含慢速 4G 或「Slow 4G」预设）。上线后用 CrUX、PageSpeed Insights 或自建 `web-vitals` 现场数据看 75 分位。任一页在移动或桌面 75 分位跌出「好」即不通过。本规范把实验室作为合并前门槛，现场数据作为上线后门槛。

### 5.2 字体引起的 CLS 与 LCP

- **规则：** 字体交换（FOUT）或不可见文本（FOIT）都可能造成布局偏移：即使文字暂时不可见，布局仍按回退字体计算，正式字体到来后仍会挪动。正文优先避免换字；必须换字时，用度量修正缩小差值，并尽早加载关键字体。过晚的网页字体还可能推迟 LCP（若 LCP 元素是文本）。
- **数值：** 与 1.8 的 `font-display` 时间窗相同；页面 CLS 仍须 ≤ 0.1（75 分位）。
- **出处：** https://web.dev/articles/optimize-cls ；https://web.dev/articles/font-best-practices ；https://web.dev/articles/reduce-webfont-size 。
- **AIHOT 怎么验收：** 禁用缓存硬刷新首页和阅读页，在 Performance 中查看 Layout Shift。由换字引起的单次移位应通过 `optional`/`fallback` 或 `size-adjust` 压到不突破 0.1。LCP 元素若是标题或正文，确认对应字体请求在关键路径尽早发出，或允许回退字体先完成绘制。

### 5.3 图片、嵌入内容与动态插入引起的 CLS

- **规则：** CLS 差的最常见原因包括：图片没有尺寸、广告/嵌入/iframe 没有尺寸、动态插入内容、网页字体。给图片和媒体设置宽高或 `aspect-ratio`，为后插入的块预留空间。用户交互后 500 ms 内的预期偏移不计入 CLS；滚动后懒加载把已可见内容顶开，仍计入。
- **数值：** CLS ≤ 0.1（75 分位）；交互宽限期 500 ms。
- **出处：** https://web.dev/articles/optimize-cls 。
- **AIHOT 怎么验收：** 所有首屏和阅读页可见图片（含公司 logo、卡片图）在 HTML 或 CSS 中有宽度和高度，或等效 `aspect-ratio`，加载前后占位高度不变。骨架屏与真实卡片同宽、同行高，替换时不把下方内容顶下去。筛选芯片引起的重排属于交互后的预期变化，但须在 500 ms 内完成，否则仍可能计入 CLS。

---

## 十套风格都必须通过的验收清单

以下 15 条只检验硬性、可测项。不评好看不好看，也不评某套风格像不像「晨报」或「毛玻璃」。任一套风格的浅色或深色有一条不通过，该风格就不能算过关。

1. **阅读页正文行长（横排）：** 桌面一行不超过 48 个汉字，目标 17–40 字；320px 宽下不少于 10 字。（clreq 7.1.1.5）
2. **行距一致且不低于下限：** 正文计算 `line-height` ≥ 1.5，同一段落内不局部撑行。（clreq 行距／行间标点）
3. **字号可放大：** 阅读页正文在 100% 缩放时计算字号 ≥ 14 px（由 clreq 五号 10.5 pt 换算）；页面放大到 200% 时，筛选、卡片、阅读页不丢内容和功能。（clreq 7.1.1.5；WCAG 2.2 1.4.4）
4. **窄屏回流：** 320 CSS px 宽的竖向页面无需双向滚动才能读完正文和筛选（必要的二维内容如数据表除外）。（WCAG 2.2 1.4.10）
5. **中西混排间距：** 汉字与拉丁字母或数字的间距 ≤ 1/4 em；行端、点号旁、夹注内侧不加这段空隙。（clreq 6.3.3）
6. **标点挤压：** 相邻各占 1 em 的夹注或点号，合计宽度 ≤ 1.5 em。（clreq 6.3.2）
7. **文本对比度：** 普通文本 ≥ 4.5:1；符合大字定义（18 pt，或 14 pt 粗体，或 CJK 等效）的标题 ≥ 3:1。每套风格的浅色和深色都要测。（WCAG 2.2 1.4.3）
8. **非文本对比度：** 芯片边界、选中态、焦点环、必要图标与相邻色 ≥ 3:1。（WCAG 2.2 1.4.11）
9. **主题 token：** 组件不写死正文/背景/边框色；参考色板与语义角色分层；十套风格和深浅只改 token 取值。文档声明 `color-scheme: light dark`，默认跟随 `prefers-color-scheme`。（Material tokens；Apple HIG Dark Mode；web.dev `color-scheme`）
10. **无错误主题闪白：** 清空缓存硬刷新后，首次绘制已是正确的浅色或深色，而不是先闪再改。（web.dev prefers-color-scheme）
11. **减弱动效：** `prefers-reduced-motion: reduce` 时，位移、缩放、旋转、视差、圆形揭示、弹性过冲全部关闭，功能保留。（Media Queries 5；Apple HIG Accessibility；Chrome 同源转场指南）
12. **减弱透明：** `prefers-reduced-transparency: reduce` 时，毛玻璃和半透明叠层改为实底，对比度仍达标。（Media Queries 5）
13. **过长自动运动可停：** 自动开始、持续超过 5 秒、与其他内容同时出现的移动/闪烁/滚动，有暂停、停止或隐藏机制。（WCAG 2.2 2.2.2）
14. **动效时长上限：** 小反馈 ≤ 200 ms，中等重排 ≤ 400 ms，整页级切换 ≤ 500 ms；减少动效关闭后不再计时长。（Material 3 easing and duration）
15. **Core Web Vitals：** 首页、筛选列表、阅读页在实验室合并前达到 LCP ≤ 2.5 s、CLS ≤ 0.1；INP 用现场数据或可交互测量，目标 ≤ 200 ms（75 分位）。图片有宽高或宽高比；字体加载不把 CLS 推出 0.1。（web.dev vitals、optimize-cls、font-best-practices）

不在本清单、因而不挡通关的项：行尾点号悬挂（可选，若开启则按 1.5 自测）、WCAG 2.2 AAA 7:1、APCA 读数、某套风格的字体选择和装饰图形。
