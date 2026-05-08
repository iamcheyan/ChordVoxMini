# 移除 Pro 付费功能 - 进度跟踪

目标：将 ChordVox 从付费+免费模式变为完全免费软件，删除所有付费、认证、使用量限制相关代码。

---

## 全部完成 ✅

### 第一轮（之前完成）

#### 删除的文件（9个）
- [x] `src/components/AuthenticationStep.tsx` — 登录/注册组件
- [x] `src/components/EmailVerificationStep.tsx` — 邮箱验证组件
- [x] `src/components/ForgotPasswordView.tsx` — 忘记密码组件
- [x] `src/components/ResetPasswordView.tsx` — 重置密码组件
- [x] `src/components/UpgradePrompt.tsx` — 升级 Pro 弹窗组件
- [x] `src/hooks/useAuth.ts` — 认证 hook
- [x] `src/hooks/useUsage.ts` — 使用量限制 hook
- [x] `src/lib/neonAuth.ts` — Neon Auth SDK 集成
- [x] `src/utils/byokDetection.ts` — BYOK（自带 Key）检测工具

#### 已修改的核心文件（12个）
- [x] `preload.js` — 移除了 auth/usage 相关 IPC 暴露
- [x] `src/App.jsx` — 移除了 auth/usage 逻辑
- [x] `src/components/ControlPanel.tsx` — 移除了付费相关 UI
- [x] `src/components/OnboardingFlow.tsx` — 修改了认证步骤
- [x] `src/components/SettingsPage.tsx` — 移除了付费设置项
- [x] `src/config/constants.ts` — 移除了 pro 常量
- [x] `src/helpers/audioManager.js` — 移除了使用量检查
- [x] `src/helpers/ipcHandlers.js` — 移除了 auth/usage IPC 处理
- [x] `src/hooks/useSettings.ts` — 移除了 auth 相关设置
- [x] `src/main.jsx` — 移除了 auth 初始化
- [x] `src/services/ReasoningService.ts` — 移除了使用量检查
- [x] `src/types/electron.ts` — 移除了 auth/usage 类型

### 第二轮（本次完成）

- [x] `main.js` — 删除了 Neon Auth verifier 相关代码（约140行）：
  - `navigateControlPanelWithVerifier()` 函数
  - `handleOAuthDeepLink()` 函数
  - `startAuthBridgeServer()` 函数及 HTTP server
  - `parseJsonBody()` / `writeCorsHeaders()` 辅助函数
  - OAuth protocol 注册（`registerChordVoxProtocol`）
  - `AUTH_BRIDGE_*` 常量和 `parseAuthBridgePort()`
  - `DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL` 常量
  - `open-url` 和 `second-instance` 中的 OAuth 处理
  - `will-quit` 中的 authBridgeServer 清理
  - Neon Auth webRequest 拦截器
  - `http` 模块导入（不再需要）

- [x] `src/components/OnboardingFlow.tsx` — 清理了认证残留：
  - 删除 `isSignedIn` 硬编码变量
  - 删除 `skipAuth` 状态
  - 删除 `SupportDropdown` 导入（未使用）
  - 删除 `localStorage` 中 `authenticationSkipped` / `skipAuth` 写入
  - 删除所有 `isSignedIn && !skipAuth` 死代码分支
  - 简化 `canProceed()` 函数
  - 简化 footer 导航逻辑

- [x] `src/hooks/useAudioRecording.js` — 删除了 `notifyLimitReached` 相关的使用量限制代码块

- [x] 翻译文件（10种语言）— 批量清理了付费相关文案：
  - 删除 `upgradePrompt` 整个 section
  - 删除 `controlPanel.billing` section
  - 删除 `controlPanel.cloudMigration` section
  - 删除 `controlPanel.limit` section
  - 删除 `settingsPage.account` 整个 section（含 billing、planDescriptions、planLabels、trialCta 等）

- [x] 检查了 `src/i18n.ts`、`src/updater.js`、`src/utils.js`、`src/config/prompts.ts`、`src/locales/prompts.ts` — 无付费相关代码

---

## 验证建议

- 运行 `npm run dev` 启动开发服务器，确认应用正常启动
- 测试 onboarding 流程是否正常完成
- 测试录音和转录功能
- 测试设置页面是否正常显示
- 运行 `npm run build` 确认构建成功

---

## 注意事项

- `audioManager.js` 中 `processWithOpenWhisprCloud` 返回的 `limitReached`/`wordsUsed`/`wordsRemaining` 字段已无消费者，但保留无害
- `ipcHandlers.js` 中的 `AUTH_EXPIRED` 错误码是 API 认证（401）相关的，不是用户账户认证，应保留
