# SDK 发布规范

首个 SDK 为 TypeScript。SDK 从 OpenAPI/JSON Schema 生成或经其验证，不维护第二套手写公共模型。

SDK 必须提供：

- 可注入 base URL、fetch 实现和认证提供器。
- 浏览器 PKCE 与服务端 token 使用边界，不接管密码。
- 统一 Problem Details 错误、游标分页和幂等键支持。
- 可取消请求、超时、有限重试；只对契约声明幂等的操作自动重试。
- 版本与 Contracts 兼容矩阵、变更记录和最小示例。

Python SDK 在出现明确第三方需求后启动，不能仅为目录对称提前维护。
