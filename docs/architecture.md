# 契约架构

## 所有权

- Core 契约：业务用户、公开资料、开发者授权、每日额度、积分消费和审计可见结果。
- Community 契约：资源、版本、文件上传、许可快照、互动、搜索、通知和审核。
- Skin 契约：创作会话、候选生成任务、成品确认和任务状态。
- Common Schema：错误、主体、游标和事件信封，只表达跨域已经稳定的语义。

## 规则

- API 主版本位于路径 `/v1`，契约包本身使用 Semantic Versioning。
- Schema `$id` 使用稳定的 `https://schemas.mc-plan.example/...` 占位命名空间；正式域名决定后通过 ADR 和兼容计划替换。
- ID 是不透明字符串；时间是 RFC 3339 UTC；二进制文件由对象存储传输，API 只交换上传会话和元数据。
- OAuth scope 是契约表面。浏览器使用 Authorization Code + PKCE，服务间使用 Client Credentials。
- 事件允许重复和乱序，消费者按 `event_id` 幂等。

## 当前成熟度

当前为 `0.1.0-draft` 骨架，只冻结边界和通用形状。具体业务字段在相应里程碑经 ADR 和实现验证后补充。
