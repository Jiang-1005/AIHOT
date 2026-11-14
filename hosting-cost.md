# 教育AIHOT 托管成本估算

核对时间：2026-11-10（Asia/Shanghai，UTC+8）。以下价格均为当时打开的官方目录价或官网标价，不含未在购买页核对的活动秒杀价。查不到的写成「未查到」，不编造。

## 结论

- **内部团队几十人：** 优先迁到腾讯云轻量应用服务器「中国香港」锐驰型 2核4G（目录价 95 元/月，年付 1,140 元，免 ICP 备案）。现在这套 Docker 应用空闲时大约只用 443 MiB 内存，2核4G 余量够跑 Postgres、定时导入和偶发流量。迁过去大约半天到 1 天。如果暂时还能接受「这台电脑一直开着才能访问」，也可以先只用自家域名接 Cloudflare 具名隧道，托管费接近 0，只付域名钱；缺点是电脑关机或更新时网站会断，且未开通 Cloudflare China Network 时，内地访问可能慢或不稳。
- **对外给家长、老师看：** 用腾讯云轻量「中国内地」锐驰型 2核4G（目录价 65 元/月；买 12 个月按官方 85 折算 663 元/年），绑定域名必须先做 ICP 备案。备案时间按阿里云官方说明：接入商初审 1～2 个工作日，管局审核一般 1～20 个工作日。在此之前不要把内地服务器域名公开给家长。海外 VPS 和「继续放在这台电脑上」都不适合作为对国内家长的正式入口。

阿里云轻量应用服务器的规格在官方文档里能对上（内地/香港都有 2核2G、2核4G），但公开帮助文档写明「具体价格以产品购买页显示为准」，这次没有在未登录的公开页面读到明确的元/月、元/年数字，故阿里云标价记为「未查到」。国内云厂商常有新用户活动价，下单前以购买页实时显示为准。

## 现在这套站实际用了多少资源

核对方式：`DOCKER_HOST=tcp://127.0.0.1:2375 docker stats --no-stream` 以及 `docker system df -v`。只读，没有停止、重启或改动任何正在跑的进程（含门禁代理和 cloudflared 隧道）。

| 容器 | CPU | 内存 |
|---|---|---|
| xintian-edu-hot-web-1 | 0.00% | 54.77 MiB |
| xintian-edu-hot-worker-1 | 0.28% | 185.7 MiB |
| xintian-edu-hot-api-1 | 0.00% | 102.3 MiB |
| xintian-edu-hot-db-1（Postgres 17） | 0.58% | 100.6 MiB |
| **合计（约）** | 接近空闲 | **约 443 MiB** |

镜像大小：应用镜像 `aihot-app` 约 459 MB，`postgres:17-alpine` 约 297 MB。数据卷：数据库约 86.91 MB，应用数据约 2.664 MB。

这是一套 Docker Compose 应用：Web（React Router 服务端渲染，对外 :3000）、API（Fastify）、Worker（pg-boss 定时任务和模型调用）、Postgres，前面还有密码门禁代理。每天还有 Python 导入脚本，会调 DeepSeek / X 接口。空闲占用很低，但导入和模型调用时内存会上去，所以正式托管建议 2核4G，不要卡在 2核2G。

DeepSeek、X 等 API 费用是现有内容成本，不计入下面的托管费。

## 对比表

人民币换算只用中国人民银行授权、中国外汇交易中心公布的 2026-11-10 人民币汇率中间价：1 美元 = 6.7167 元，1 欧元 = 7.5071 元。原文在中国经济网对官方公告的转载中；中国外汇交易中心页面是动态加载，这次未在其静态内容里读到当日数字。Hetzner 官网价不含增值税，中国客户实际是否缴欧盟增值税未查到，表中按不含税价换算，并同时保留原币。

| 方案 | 月费（目录价） | 年费（目录价） | 备案 | 内地访问 | 维护量 | 价格来源（2026-11-10 打开） |
|---|---|---|---|---|---|---|
| 腾讯云轻量 · 内地 · 锐驰型 2核2G（40 GB 盘，峰值 200 Mbps，无限流量） | 45 元 | 459 元（45×12×0.85；官方规定买 12 个月及以上 85 折） | 绑定域名需要 ICP 备案 | 好（同地区） | 低：一台机器跑 Docker Compose | [腾讯云轻量价格总览](https://cloud.tencent.com/document/product/1207/73452)（文档更新 2026-09-24） |
| 腾讯云轻量 · 内地 · 锐驰型 2核4G（50 GB 盘，峰值 200 Mbps，无限流量）**推荐对外** | 65 元 | 663 元（65×12×0.85） | 同上 | 好 | 同上 | 同上 |
| 腾讯云轻量 · 香港 · 锐驰型 2核2G（40 GB 盘，峰值 200 Mbps，无限流量） | 55 元 | 660 元（55×12；香港 2核2G/2核4G 锐驰型不适用年付折扣） | 不需要 ICP 备案 | 一般可用，但跨境质量不保证 | 低 | 同上，「中国香港地域」Linux 套餐 |
| 腾讯云轻量 · 香港 · 锐驰型 2核4G（60 GB 盘，峰值 200 Mbps，无限流量）**推荐内部试用** | 95 元 | 1,140 元（95×12，无年付折扣） | 不需要 ICP 备案 | 同上 | 低 | 同上 |
| 阿里云轻量 · 内地或香港 · 2核2G / 2核4G | **未查到**公开目录价 | **未查到** | 内地需要备案；香港不需要 | 内地好；香港官方提示内地访问可能有较高延迟和丢包 | 低 | 规格见 [实例规格族](https://help.aliyun.com/zh/simple-application-server/product-overview/instance-families/)；[计费项](https://help.aliyun.com/zh/simple-application-server/product-overview/billable-items) 写明「具体价格以产品购买页显示为准」。[产品页](https://www.aliyun.com/product/swas) 未登录时未读到元/月数字 |
| Hetzner Cloud CX23 · 欧洲（2 vCPU / 4 GB / 40 GB NVMe / 含 20 TB 流量） | 官网 €5.99/月（不含增值税），约 45 元 | €71.88/年（5.99×12，无年付折扣），约 540 元 | 不需要 ICP 备案 | 从内地到欧洲的时延、丢包：**未查到**可引用的实测来源。Cloudflare 官方称，经中国境外服务器绕行的流量会面临明显的延迟和可靠性问题 | 中：要自己管系统、备份、防火墙 | [Hetzner Cloud](https://www.hetzner.com/cloud/)、[Cost-Optimized](https://www.hetzner.com/cloud/cost-optimized/)。页面上 CX23 旁标了 not available，下单时可能缺货 |
| DigitalOcean Basic Droplet · 2 vCPU / 2 GB / 60 GB SSD / 含 3,000 GiB 流量 | $18/月，约 121 元 | $216/年（18×12，无年付折扣），约 1,451 元 | 不需要 ICP 备案 | 从内地访问的时延：**未查到**可引用的实测来源。DigitalOcean 在新加坡有机房，但本文未测内地到各区域的速度 | 中 | [DigitalOcean Droplet 定价](https://www.digitalocean.com/pricing/droplets)（页面注明 2026-01-01 起按秒计费，包月封顶） |
| DigitalOcean Basic Droplet · 2 vCPU / 4 GB / 80 GB SSD / 含 4,000 GiB 流量 | $24/月，约 161 元 | $288/年，约 1,934 元 | 不需要 ICP 备案 | 同上 | 中 | 同上 |
| 继续放在现有机器上 + Cloudflare 具名隧道 + 自有域名 | 隧道和 Zero Trust 免费档 0 美元；另加域名费（见下文） | 同上 | 域名若不解析到中国内地服务器，不需要 ICP 备案 | 取决于 Cloudflare 在内地的连通性。未购买 Enterprise 的 China Network 时，官方也指出经境外节点会有延迟和可靠性问题 | 低配置、高值守：这台电脑必须一直开着 | 隧道限额：[Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)；Zero Trust 免费档：[Plans](https://www.cloudflare.com/plans/zero-trust-services/)；发布应用需自有域名：[Tunnel 入门](https://developers.cloudflare.com/tunnel/get-started/)；中国网络：[China Network](https://developers.cloudflare.com/china-network/) |
| 拆成静态站或 Serverless | 不单独报价 | — | — | — | 改造量大 | 见下文「为什么不建议拆成静态/Serverless」 |

补充（同一官方价目表，备查，不是首选）：

- 腾讯云内地「入门型」2核2G（4 Mbps、每月 300 GB 流量、50 GB 盘）48 元/月，年付 85 折约 489.6 元；2核4G（5 Mbps、每月 500 GB 流量、60 GB 盘）65 元/月，年付 663 元。流量超出后内地按 0.8 元/GB。来源同上价格总览。
- 腾讯云香港「入门型」2核2G 38 元/月、2核4G 90 元/月（Linux）。官方注明：香港入门型无法保障内地与香港之间的跨境公网质量，可能出现较大延迟和丢包，不建议当作对内地用户的主方案。
- Hetzner 新加坡站官方页给出的是 CPX12（1 核 / 2 GB，€15.99/月，不含增值税）和 CCX13（2 核 / 8 GB，€54.49/月），没有查到新加坡地区 2 vCPU / 2–4 GB 的对应标价。来源：[Hetzner Cloud Singapore](https://www.hetzner.com/cloud-singapore/)。
- 上面腾讯云内地、香港价格按 Linux 套餐抄写；Windows 套餐在同一文档里另有一表，更贵，本站用 Linux，不必买 Windows。

## 备案和域名

### ICP 备案（中国内地服务器 + 域名）

依据阿里云官方备案说明（2026-11-10 打开）：

- 中国内地服务器必须在接入商平台完成 ICP 备案，否则网站有被关停的风险。使用中国香港或海外服务器不需要 ICP 备案。来源：[ICP备案流程概述](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)。
- 时间：提交后，阿里云初审一般 1～2 个工作日；通过后经工信部短信核验，再交管局审核，管局审核一般 1～20 个工作日，不能加急，以实际为准。同一页。
- 必备材料（个人）：本人有效身份证件原件照片（内地居民用身份证；证件剩余有效期须不少于 3 个月）。部分省份还要域名证书、手持证件照等。企业：营业执照等主办单位证件，以及负责人身份证件；部分省份负责人非法人时还要授权书。来源：[ICP备案所需资料](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/required-materials)。
- 备案成功后，网站首页底部要放备案号并链到工信部。开通后 30 天内还要做公安联网备案。官方还写：即使用香港或海外服务器、无需 ICP 备案，**若网站在中国内地可访问，仍须在开通后 30 天内做公安联网备案**。来源同上流程概述。

### 域名价格与实名

- **.com、.cn 的精确公开标价：未查到。** 阿里云万网「域名价格总览」页是动态加载，这次抓取结果里没有具体数字（[价格总览](https://wanwang.aliyun.com/help/price.html)）。腾讯云官方只写「以官网售卖价格为准」，并指向需调用接口的价格表，未登录时没有读到 .com / .cn 的元/年数字（[域名定价相关](https://cloud.tencent.com/document/faq/242/3708)）。Cloudflare Registrar 的官方说明是按注册局和 ICANN 成本价、不加价，但已打开的介绍页和文档里没有列出当前 .com 的美元数字（[What is Cloudflare Registrar](https://www.cloudflare.com/learning/domain-registration/what-is-cloudflare-registrar/)、[Registrar FAQ](https://developers.cloudflare.com/registrar/faq/)）。
- **.cn 必须实名认证。** 阿里云官方：按中国内地监管要求，所有域名都要完成实名认证才能正常解析；未完成会被注册局锁定（`serverHold`）。个人通常交身份证，企业交统一社会信用代码证书或营业执照。来源：[如何完成域名实名认证](https://help.aliyun.com/zh/dws/user-guide/how-to-complete-domain-name-authentication)。CNNIC 也说明，申请 .cn 时自然人要提交姓名和身份证件等信息，组织要提交单位证件；域名用于网站应用时，还要按工信部要求做网站备案。来源：[CN域名注册常见问题](https://www.cnnic.cn/n4/2022/0919/c90-10604.html)（页面标注 2024-09-23）。
- Cloudflare Registrar 是否出售 .cn：这次打开的官方文档没有列出支持 .cn 的说明，记为 **未查到**。若要用 .cn，更稳妥的是在国内注册商处注册并完成实名。

### Cloudflare 具名隧道（方案 3）的免费档限额

2026-11-10 打开的官方说明：

- 发布到自定义域名需要：一个 Cloudflare 账号，以及已经接入 Cloudflare 的域名；本机安装 `cloudflared`。来源：[Set up Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)。现在用的临时 `trycloudflare.com` 地址属于 Quick Tunnel，不是具名隧道。
- 每个账号最多 1,000 条 tunnel；每条 tunnel 最多 25 个活跃 `cloudflared` 副本；路由 50,000 条。来源：[Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)。
- 若再用 Cloudflare Access（Zero Trust）做登录：免费档 $0，限制 50 个用户，日志最多保留 24 小时。来源：[Zero Trust Plans](https://www.cloudflare.com/plans/zero-trust-services/)。内部几十人还够；以后到 100 人以上会碰到 50 人上限。现在站点已有密码门禁，不一定非开 Access。
- 内地访问：Cloudflare China Network 跑在合作方京东云的内地机房，仅作为 Enterprise 计划的单独订阅提供；接入还需要该顶级域已有有效 ICP 备案或许可证。来源：[Cloudflare China Network](https://developers.cloudflare.com/china-network/)。未买这项时，流量走境外节点，官方写明会面临明显的延迟和可靠性问题。

方案 3 的结构性缺点（与价格无关）：网站只能在这台电脑开机且进程正常时访问；机器重启、更新或掉线，对外地址会中断。这不是多花一点钱能解决的，除非再迁到云服务器。

## 为什么不建议拆成静态站或 Serverless

看过 `/workspace/edu-hot` 的 `docker-compose.yml`、`docs/architecture.md` 和 `scripts/` 后的判断，不是报价：

- 网页是服务端渲染，读的是 API，API 再读 Postgres，不是可以预先生成的静态页。
- 另有常驻 Worker 跑采集、模型调用、归组和定时任务。
- 每天还有 Python 导入脚本，并调用 DeepSeek / X。
- 数据要持续写入数据库，不能只放到对象存储里了事。

如果硬拆，等于把「Web + API + Worker + 数据库 + 任务队列」重做成一套云函数和托管数据库，工作量远大于把现有 Compose 搬到一台 2核4G 云服务器。因此这一档不单独报价。

## 一次性迁移工作量（粗估）

这是工作量判断，不是报价。

| 路径 | 大概时间 | 要做的事 |
|---|---|---|
| 腾讯云香港 2核4G | 约 0.5–1 天 | 买机器、装 Docker、搬现有 Compose 和数据卷、配 Caddy/HTTPS 和现有密码门禁、解析域名、冒烟测试（首页、筛选、导入任务） |
| 腾讯云内地 2核4G | 机器迁移同样约 0.5–1 天；外加备案 | 先准备域名实名和备案材料；初审 1～2 个工作日 + 管局 1～20 个工作日。备案完成前不要把内地域名公开给家长 |
| 现有机器 + 具名隧道 | 约数小时 | 注册并接入域名、把临时隧道改成具名隧道、保留门禁、确认开机自启。不能消除「电脑关机网站就断」 |
| Hetzner / DigitalOcean | 约 1 天 | 与香港云主机类似，另加：付款与账号、SSH 和防火墙、从内地访问的连通性自测（本文未测） |

搬家时可以把现在的 Docker 镜像和数据卷原样带走，不必重写应用。不要在迁移过程中停掉正在为同事提供访问的门禁和隧道，除非已经约好切换窗口。

## 来源与核对说明

- 腾讯云轻量目录价、时长折扣、香港价、超额流量：[https://cloud.tencent.com/document/product/1207/73452](https://cloud.tencent.com/document/product/1207/73452)，文档更新时间 2026-09-24，本次打开 2026-11-10。
- 阿里云轻量规格：[https://help.aliyun.com/zh/simple-application-server/product-overview/instance-families/](https://help.aliyun.com/zh/simple-application-server/product-overview/instance-families/)；计费说明：[https://help.aliyun.com/zh/simple-application-server/product-overview/billable-items](https://help.aliyun.com/zh/simple-application-server/product-overview/billable-items)；地域与连通性：[https://help.aliyun.com/zh/simple-application-server/product-overview/regions-and-network-connectivity](https://help.aliyun.com/zh/simple-application-server/product-overview/regions-and-network-connectivity)。
- ICP 备案流程与时间、香港/海外免备案、公安联网备案：[https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)。所需资料：[https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/required-materials](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/required-materials)。
- Hetzner：[https://www.hetzner.com/cloud/](https://www.hetzner.com/cloud/)、[https://www.hetzner.com/cloud/cost-optimized/](https://www.hetzner.com/cloud/cost-optimized/)、[https://www.hetzner.com/cloud-singapore/](https://www.hetzner.com/cloud-singapore/)。
- DigitalOcean：[https://www.digitalocean.com/pricing/droplets](https://www.digitalocean.com/pricing/droplets)。
- Cloudflare Tunnel / Zero Trust / China Network：上文各节已附链接。
- 汇率：中国经济网转载「中国人民银行授权中国外汇交易中心公布」的 2026-11-10 中间价，[http://finance.ce.cn/fe/gdxw/202611/t20261110_3289497.shtml](http://finance.ce.cn/fe/gdxw/202611/t20261110_3289497.shtml)。中国外汇交易中心原页 [https://www.chinamoney.com.cn/chinese/bkccpr/](https://www.chinamoney.com.cn/chinese/bkccpr/) 为动态页，本次未在静态内容中读到当日数字。
- 域名精确标价、阿里云轻量精确标价、Hetzner/DigitalOcean 从内地访问的实测时延：本次均 **未查到** 可直接引用的官方数字或实测来源。
