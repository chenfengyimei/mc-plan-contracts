# @mc-plan/skin-sdk

已验收 Skin Standalone 公共 API 的官方 TypeScript 客户端（`0.1.0-alpha.1`，ADR-0012 匿名窗口）。

- **来源**：类型由 `openapi-typescript` 从本仓库锁定的 `openapi/skin.yaml`（0.1.0-alpha.1，锁提交 `3006402`）确定性生成；`SUPPORTED_CONTRACT_FILES` 内嵌生成输入文件的 sha256，`pnpm test` 会按真实文件复算，任何契约漂移都会失败。`pnpm generate:check` 重跑生成并要求 `git diff` 为空。
- **支持面**：仅 `SUPPORTED_OPERATIONS` 列出的 8 个有 producer 证据的操作（producer 锚定 mc-plan-skin `14a8fe3`，即 MCP-F1-SKIN-008/009 最终树）。Official 模式/Community 发布/F3 集成表面不提供可调用方法（Q-001/Q-011/Q-012/Q-013 所有者门槛未决）。
- **匿名窗口**：Standalone 表面无凭据对象模型——客户端不接受任何 token 提供器、绝不发送凭据头；一切资源经不可猜测 128-bit UUID 寻址，会话保留 30 天、候选 24 小时，过期/未知/已删除统一 404 不区分原因。
- **传输**：注入 `fetch` 实现与 `baseUrl`（必填，无默认值）；`AbortSignal` 与可配置超时（默认 10 秒）；全部 8 个操作契约幂等（5 个 GET + 3 个必填 Idempotency-Key 命令），5xx/网络错误有界重试（默认 ≤2 次，硬上限 4）且**重试不换 Idempotency-Key**；同键同请求重放原始响应、同键异请求由生产者拒绝 409 `SKIN_IDEMPOTENCY_CONFLICT`。
- **字节**：`getCandidatePreview`/`downloadSkin` 返回 `{ bytes, mediaType }`，SDK 按契约先验 PNG 魔数与 64x64 IHDR——非 64x64 PNG 直接抛错，不把坏字节交给调用方。
- **错误**：`application/problem+json` 解析为 `McPlanProblemError`（`problem.code` 含 10 个生产者稳定 `SKIN_*` 错误码联合类型、`trace_id`、可选 `errors[]`）；非 Problem 形状的错误响应抛 `McPlanUnexpectedResponseError`。
- **版本与发布**：版本随契约预发布（`0.1.0-alpha.1`）；本包 private，仅经 `pnpm pack` 本地消费，不发布 npm、不设稳定版本；已验证组合记录在 `docs/compatibility.md`（producer 验收与 SDK/consumer 验收分栏）。

## 使用

```ts
import { createMcPlanSkinClient, generateIdempotencyKey } from '@mc-plan/skin-sdk';

const client = createMcPlanSkinClient({
  baseUrl: 'https://skin-api.example.com',
});

const conversation = await client.createConversation(
  { initial_message: 'a snow explorer with a deep blue scarf' },
  generateIdempotencyKey(), // keep stable across retries of the same logical command
);
const accepted = await client.createRender(
  conversation.conversation_id,
  { message: 'cooler tones, please' },
  generateIdempotencyKey(),
);
const job = await client.getJob(accepted.job_id); // poll until succeeded/failed
if (job.status === 'succeeded' && job.candidate_id) {
  const preview = await client.getCandidatePreview(conversation.conversation_id, job.candidate_id); // { bytes: 64x64 PNG, mediaType: 'image/png' }
}
```

## 本包验收命令（见仓库 docs/development-plan.md）

```sh
pnpm --dir sdk/skin format:check
pnpm --dir sdk/skin lint
pnpm --dir sdk/skin typecheck
pnpm --dir sdk/skin generate:check
pnpm --dir sdk/skin test
pnpm --dir sdk/skin build
pnpm --dir sdk/skin pack:check
pnpm --dir sdk/skin smoke:real   # 生产者树 + 隔离 PostgreSQL/Redis 的真实 HTTP 验收（确定性 Fake Provider，离线）
```

Python SDK 在出现明确第三方需求前不启动（见 `docs/sdk.md`）。

2026-10-16 alpha.1（`MCP-F1-CONTRACTS-007`）：首个 Skin SDK 切片，暴露全部 8 个 producer 已验证操作（producer 锚定 skin `14a8fe3`）；对生产者树 + 隔离 PostgreSQL/Redis + 确定性 Fake Provider 的真实 HTTP smoke 覆盖 创建→渲染轮询→预览→确认轮询→下载→详情→删除 全链、幂等重放与 409 `SKIN_IDEMPOTENCY_CONFLICT`、尝试次数耗尽 409、404 家族与删除不复活。
