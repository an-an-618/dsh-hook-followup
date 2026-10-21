# Changelog

## 0.1.0 — 2026-10-21

首个公开版本。

- 模型通过 `followup` 工具提交一句 Hook 追问和 1–3 条快捷回复，正文随后输出。
- Client 在 `conversation.chat.turnTail` 渲染 Hook 行和可点击胶囊；点击通过 `conversation.send` 作为普通用户消息发回。
- 支持 `always` / `balanced` / `conservative` 三种追问策略，可跳过拒绝回答和情绪场景。
- 支持 `ui` / `markdown` / `tag` 三种渲染模式，`follow_user` / `zh` / `en` 语言策略。
- 不依赖 Intelligent UI，可单独安装和卸载。
