# Hook Follow-up for DeepSeek Harness

在每轮回答末尾附加一句锚定正文的追问和 1–3 条用户口吻的快捷回复。快捷回复渲染成本轮末尾的胶囊按钮，点一下就把那句话作为普通用户消息发回模型。

这是把「文末 Hook 追问 + 快捷回复」的产品描述落到 DSH 的一个完整插件，复用了 Intelligent UI（`@an-an-618/dsh-intelligent-ui`）验证过的扩展方式，但**不依赖**它：可以单独安装、单独卸载。

## 安装

### 从 dsh-market 安装

收录后可在 [dsh-market](https://github.com/dsh-market/dsh-market) 或 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 里搜索 `Hook Follow-up` 一键安装。收录进度见 [awesome-dsh-plugin PR](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pulls?q=an-an-618)。

### 直接安装（固定 commit）

```text
plugin_manager(action: "install_bundle", target: "git+https://github.com/an-an-618/dsh-hook-followup.git#7a90d03c3edb3f84e93dfdc7b426951857c3d6c4")
```

安装后重启 DSH 生效。

### 从 Release tarball 安装

```text
plugin_manager(action: "install_bundle", target: "https://github.com/an-an-618/dsh-hook-followup/releases/download/v0.1.0/an-an-618-dsh-hook-followup-0.1.0.tgz")
```

### 从本地目录安装（开发）

```text
plugin_manager(action: "install_bundle", target: "/absolute/path/to/hook-followup")
```

## 结论：不解析标签，也不在正文之后调工具

原描述里 `render_mode = tag` 要求模型在正文末尾写 `<followup>` 标签，由前端解析后替换成按钮。这个方案在 DSH 里有两个硬问题：

1. **标签会露出来。** 正文走的是 shipped 的 Markdown 渲染器，插件没有稳定的「消息渲染钩子」。读 DSH 的 Markdown 实现可以确认：`html` 节点会原样作为文本返回，所以 HTML 注释也不行；要抹掉标签只能整段替换 shipped 的 `assistant-step` 渲染器，升级即碎。
2. **在正文之后调用工具会把正文折叠掉。** DSH 的 chat 有一个 Turn Process 折叠投影，判定「最终回答」的规则是最后一步 assistant 消息不含任何 tool-call（`latestAnswer()` 对含 tool-call 的最终步直接返回 null）。如果模型先写正文、再调 `followup`，这一轮就没有「最终回答」，正文会被折叠进默认收起的「过程」区，用户看不到。

所以采用**先提交、再写正文**的工具流：

1. 模型先想清楚完整正文，调用 `followup` 提交 `{ hook, replies }`；
2. 工具把内容写进 `presentationMeta` 并返回一句回执「请立即输出完整正文」；
3. 模型在下一步输出完整正文（纯文本、不再调工具），turn 正常结束；
4. Client 从本轮 tool result 的 `meta` 读回 Hook 和快捷回复，在 turnTail 渲染胶囊。

这样正文仍然是「最后一步、无工具调用」的 assistant 消息，折叠逻辑不会误伤它；工具行只会作为一条过程记录被收进过程折叠区。

| 产品描述里的层 | 本插件的落点 | 复用了什么 |
|---|---|---|
| 模型输出结构化数据 | `followup` 工具的 `{ hook, replies }` 参数 | `ctx.tools.register` |
| 前端渲染 | `conversation.chat.turnTail` 里的 Hook 行 + 快捷回复胶囊 | ui-chat 的公开插槽 |
| 持久化 | `output.presentationMeta` 写进 tool result | DSH 官方元数据通道 |
| 用户点击回传 | `conversation.send(text)`，一条普通用户消息 | 与 Intelligent UI 提交同一条路径 |
| 不新增事件类型 | 只使用 shipped 的 user message | 会话日志保持可回放 |

代价是每轮多一次模型请求（写正文的那一步）——这是任何「需要工具先把结构化数据交给前端」的方案都绕不开的成本。不调工具时（省略 Hook）仍然只有一次请求。

`render_mode` 的 `markdown` / `tag` 保留为**纯提示词降级**：不注册工具，模型自己把降级块写在正文末尾，供没有本插件 Client 半体的前端消费。在 DSH 内默认用 `ui`。

## 用户看到的样子

回答正文照常。正文之后（本轮 turn tail）是：

```
↳ 这三种里，你更想先试哪一种？
[ 先从走路开始 ]
[ 在家练自重的话怎么安排？ ]
[ 我体能很差，爬三楼就喘，这种情况先做什么比较稳 ]
```

胶囊竖排，外观接近普通次级按钮：浅灰底、常规描边、主文字色、500 字重；hover 只做中性加深。Hook 行是 `↳` 加正文色问题（500 字重）；胶囊竖排、外观接近普通次级按钮，强调色只留给键盘 focus 描边。

点第一条，插件调用 `conversation.send('先从走路开始')`；下一条用户消息就是这句话本身，没有前缀、没有结构化包装。发送后胶囊禁用；新回合开始后旧胶囊也会自动禁用。

## 安装与验证

```sh
cd "hook-followup"
node scripts/check.mjs
```

自检会执行 `node --check`、Host/Client 两套测试、提示词模板检查（任何 `{{` 都会让 DSH 每轮报模板错误）、清单、locale 与源码卫生检查。

```text
plugin_manager(action: "install_bundle", target: "/Users/bytedance/Desktop/dsh try/hook-followup")
```

本工作区已经安装并验证过 Host 与 Client 注册：

- Host `Tool.listTools` 返回 `followup`，描述与参数正确；
- Client `tool.call.toolview` 出现 `followup` occupant（active）；
- Client `conversation.chat.turnTail` 出现 `hook-followup` occupant（order 30，active）；
- 系统提示词里出现 `hook-followup` 段。

移除：

```text
plugin_manager(action: "remove_bundle", target: "@an-an-618/dsh-hook-followup")
```

## 配置

这些字段同时是 row config 和插件的设置页字段（`export const Config`，schemastery）。在 **设置 → 插件 → 文末 Hook 追问** 里改，`volatile()` 字段会直接写进运行中的配置，下一轮就生效，不用重启 Host。

| 设置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关。关闭后系统提示不再注入追问规则，`followup` 调用会被拒绝。 |
| `strategy` | `always` | `always` = 应出尽出；`balanced` = 平衡（额外省略严格格式、连续两轮未点击且话题收束）；`conservative` = 克制（再额外省略仍有工具调用的轮次）。 |
| `skip_on_refusal` | `true` | 本轮是拒绝回答时是否整块省略。 |
| `skip_on_emotional` | `true` | 用户处于情绪危机、哀伤、自伤风险时是否整块省略。 |
| `max_replies` | `3` | 快捷回复上限，收敛到 1–3；实际条数按路径数量给。 |
| `render_mode` | `ui` | `ui` = 调用工具并渲染胶囊；`markdown` / `tag` = 纯提示词降级，不注册工具。 |
| `language` | `follow_user` | `follow_user` = 追问内容跟随用户语言（规则文本仍为中文）；`zh` / `en` 同时固定规则文本语言。 |

`strategy` 决定严格格式、连续未点击、待工具这几条的默认取舍；`skip_on_refusal` / `skip_on_emotional` 是两个独立开关，优先于策略。两处都在同一张设置页上，随时可改。

两个结构性例外：`enabled` 从关到开、以及 `render_mode` 从 `markdown`/`tag` 改回 `ui`，需要重新启用或重载一次插件（工具注册发生在挂载时）。反向操作（运行中关闭、`ui` 改成降级）立即生效。

## 行为要点（都写进了系统提示词段）

- **应出尽出（默认 `strategy: always`）**：每轮回答默认都调用一次 `followup`；只有用户明确表示结束、处于情绪危机、或本轮是拒绝回答时才整块省略。纯代码 / JSON / 译文不构成省略理由（卡片在正文之外，不影响复制）；正文以澄清问题结尾时 `hook` 留空、只给快捷回复。问得不够精彩同样不构成省略理由。切到 `balanced` / `conservative` 会按设置页增加对应的省略条件。
- **Hook 锚定正文**：一句一问，锚定刚提到的分支、未定变量或可落地下一步；中文 ≤40 字，英文 ≤25 词；禁止空泛兜底、重复已答、夸张钩子、一句多问。
- **快捷回复是用户的话**：第一人称或省略主语，至少一条直接回答 Hook，其余走深挖/落地/结合自身/合理质疑；互斥、自足、数量按实际路径给（1–3 条，通常 1–2 条，不凑满）、长度自然参差但顺序随意（不强制由短到长）、口语化、不重复历史。
- **正文已以问题结尾时**：`hook` 留空，只给快捷回复。
- **先提交、再写正文**：提示词明确要求先调 `followup`，工具结果返回后再写正文；并明确禁止在正文之后调用。
- **宿主校验**：`replies` 必填、1–`max_replies` 条、去首尾空白、非空、不重复、单条 ≤200 字符；失败时抛出可重试的工具错误，模型可以自己改正或直接写正文。

## 与 Intelligent UI 的关系

复用同一套模式，不共享运行时：

- 一样的「Host 工具 + `presentationMeta` 持久化 + Client 插槽读取」链路；
- 一样用 `conversation.send(text)` 把用户选择送回模型；
- Client 同样以 `window.__ModuleLoader__.load({ id, factory })` 注册，只使用 `--dsw-*` 主题 token 和 Client locale，不 import primitives；
- 但没有复用它的卡片解释器：快捷回复不是一张卡，用一条 tool 元数据 + 一行胶囊比走 spec/编译器轻得多，也不会和 `render_ui` / `ask_with_ui` 的卡片语义混在一起。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半体：注册 `followup` 工具与系统提示词段 |
| `lib/meta.js` | 参数校验、持久化元数据形状（`{ v, kind, hook, replies }`） |
| `lib/prompt.js` | 中英提示词、工具描述、回执、行配置归一化 |
| `client.js` | 浏览器半体：tool 行摘要 + turnTail 胶囊 + 发送 + 置灰逻辑 |
| `test/host.test.mjs` | Host 单测：配置、注册、校验、提示词模板 |
| `test/client.test.mjs` | Client 单测：插槽注册、快照读取、点击发送、禁用态、错误态 |
| `scripts/check.mjs` | 安装前自检 |

## 已知限制

- **模型顺序错误**：如果模型违反提示词，先写正文再调 `followup`，正文会被折叠进过程区。这是 DSH 折叠规则决定的，插件无法在执行期改写；提示词已用一整段专门约束，但无法 100% 保证。
- **多一次模型请求**：采用先提交、再写正文后，每轮多一次「写正文」的请求。省略 Hook 时不增加。
- **点击与手打的区分**：快捷回复发出的就是纯文本用户消息，Host 无法区分「点了胶囊」和「用户手打了同一句话」。提示词让模型用「历史里是否出现过同文本的回复」自行推断，因此规则「最近两轮都没点」是软约束。
- **旧回合的胶囊**：只有最近一轮可点；更早回合的胶囊会置灰，避免在旧上下文里插入新消息。
- **客户端缺席**：如果某个组合没有 ui-chat 的 turnTail 插槽，Client 会跳过注册（记一条 warn），只剩工具行摘要，没有可点的胶囊；`markdown` / `tag` 模式不受影响。
- **提示词成本**：规则段约 1.2k token，工具描述另计。`enabled: false` 可整块关掉。
