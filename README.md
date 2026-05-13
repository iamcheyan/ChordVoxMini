<p align="center">
  <img src="assets/logo.png" alt="ChordVox" width="128" />
</p>

<h1 align="center">ChordVox (Open Source & Offline Version)</h1>

<p align="center">
  <strong>100% 离线、100% 免费、100% 隐私保护。</strong><br>
  不再有订阅费用，不再有付费墙，所有功能都在本地完成。
</p>

<p align="center">
  <a href="./README.zh.md">中文说明文档</a> | <a href="./README.md">English Documentation</a>
</p>

---

### 项目愿景

这个版本的 **ChordVox** 是基于原始项目的彻底重构，我们的目标是打造一个真正的“离线优先”语音助手。

1. **移除所有付费限制**：去掉了原版中所有的 Pro 订阅、API 计费和付费锁定功能。
2. **纯粹的本地化**：所有的语音识别、文本精修、翻译功能都运行在你的本地机器上。你的隐私数据永远不会离开你的设备。
3. **加入离线翻译**：新增了基于 NLLB-200 的离线翻译引擎，现在支持中文说出，自动翻译成日语并输入。

---

### 核心功能

- ⌨️ **即说即贴**：一个快捷键触发：录音 → 识别 →（可选）翻译 → 粘贴到光标处。
- 🧠 **本地 AI 精修**：内置本地 LLM 引擎，自动去除语气词、修正标语，让口语变成书面语。
- 🌐 **离线翻译 (NEW)**：内置中日翻译模型。你只需要说中文，程序会自动将其转换为流畅的日语并输入。
- 🔒 **隐私至上**：不需要联网，不需要账号，没有数据追踪。

---

### 性能优化 (针对 Mac 用户)

我们专门为 Mac 用户（尤其是 M1/M2/M3 芯片）进行了深度优化：
- **硬件加速**：翻译引擎已接入 CoreML 加速，大幅提升推理速度并降低能耗。
- **持久化进程**：优化了模型加载逻辑，模型常驻内存，翻译响应达到毫秒级。

---

### 技术栈

- **前端/外壳**: Electron 36, React 19, TypeScript
- **语音引擎**: whisper.cpp, NVIDIA Parakeet, SenseVoice
- **翻译引擎**: NLLB-200 (ONNX Runtime with CoreML)
- **本地 LLM**: llama.cpp (支持 GGUF 模型)

---

### ⚠️ 重要提醒

1. **早期版本**：由于开发时间比较仓促，目前可能存在不少细节问题和 Bug。
2. **平台测试**：我们目前**仅在 macOS 上进行了深度测试**。对于 Windows 和 Linux 用户，可能需要自行解决环境依赖问题。
3. **自行解决问题**：作为一个开源项目，我们鼓励用户自行调试和解决使用中的问题，目前暂无专业的技术支持团队。

---

### 如何开始

1. **克隆项目**：
   ```bash
   git clone https://github.com/iamcheyan/ChordVoxMini.git
   ```
2. **安装依赖**：
   ```bash
   npm install
   ```
3. **运行开发版**：
   ```bash
   npm run dev
   ```

---

### 开源许可

本项目遵循 MIT 开源许可。
