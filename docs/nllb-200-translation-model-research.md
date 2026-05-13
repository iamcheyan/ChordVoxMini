# NLLB-200 中日翻译模型调研

## 模型信息

- **模型**: Meta NLLB-200 Distilled 600M (`facebook/nllb-200-distilled-600M`)
- **ONNX 导出**: Xenova (`Xenova/nllb-200-distilled-600M`)
- **支持语言数**: 200+
- **模型大小**: Encoder ~1.7GB (FP32) / ~415MB (INT8), Decoder ~1.9GB (FP32) / ~1.5GB (INT8)
- **翻译方向**: 中文(zho_Hans) ↔ 日文(jpn_Jpan) 直接翻译，无需英文中转

## 本地文件路径

```
~/.cache/chordvox/translation-models/nllb-200-distilled-600M/
├── config.json
├── generation_config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── sentencepiece.bpe.model          # 从 facebook/nllb-200-distilled-600M 下载
└── onnx/
    ├── encoder_model.onnx           # FP32, 1.7GB
    ├── encoder_model_int8.onnx      # INT8, 415MB
    ├── decoder_model_merged.onnx    # FP32, 1.9GB (含 KV cache)
    └── decoder_model_merged_int8.onnx  # INT8, 1.5GB
```

## 关键 Token ID

| Token | ID | 用途 |
|-------|-----|------|
| zho_Hans | 256201 | 中文源语言 / 日→中目标语言 |
| jpn_Jpan | 256080 | 日文源语言 / 中→日目标语言 |
| eos (`</s>`) | 2 | 句子结束 |
| pad (`<pad>`) | 1 | 填充 |
| decoder_start_token_id | 2 | 解码器起始 token（=`</s>`） |

## 测试结果

### 通过 optimum 库（正确）

```
Chinese → Japanese:
  你好           → じゃあどうぞ
  今天天气很好   → 今日は天気が良い
  我是学生       → 私は学生です
  谢谢           → ありがとうございました
  我想去日本旅游 → 日本旅行に行きたい

Japanese → Chinese:
  こんにちは         → 您好
  今日はいい天気です → 今天天气很好
  ありがとう         → 谢谢你
```

### 通过裸 onnxruntime（失败）

直接用 `onnxruntime-node` 调用 ONNX 文件会输出垃圾（重复 token 或单个错误字符），原因是 Xenova 导出的 ONNX 格式需要 `optimum` 特定的 KV cache 管理逻辑。

## ONNX 推理的关键技术细节

### Decoder 输入/输出

Decoder 是 merged 格式，包含 KV cache 输入：

**输入**:
- `input_ids`: [batch, decoder_seq_len]
- `encoder_hidden_states`: [batch, encoder_seq_len, 1024]
- `encoder_attention_mask`: [batch, encoder_seq_len]
- `use_cache_branch`: bool — False=首次推理（模型内部计算 cross-attention KV），True=后续推理（使用缓存的 KV）
- `past_key_values.{layer}.decoder.key/value`: [batch, 16, past_decoder_seq_len, 64]
- `past_key_values.{layer}.encoder.key/value`: [batch, 16, encoder_seq_len, 64]

**输出**:
- `logits`: [batch, decoder_seq_len, 256206]
- `present.{layer}.decoder.key/value`: self-attention KV
- `present.{layer}.encoder.key/value`: cross-attention KV

### Optimum 的 KV Cache 处理逻辑（从源码提取）

```
首次推理 (past_key_values=None):
  1. use_cache_branch = False
  2. 所有 past_key_values 传空数组 shape=(1, 16, 0, 64)
  3. decoder 输入 = [[decoder_start_token_id]]  (即 2 = </s>)
  4. 模型内部从 encoder_hidden_states 计算 cross-attention KV

后续推理 (past_key_values≠None):
  1. use_cache_branch = True
  2. past_key_values = 上一步的 present.* 输出
  3. decoder 输入 = [[next_token_id]]
  4. cross-attention KV 从缓存读取，不再重新计算
```

### 重要发现

1. **`use_cache_branch` 是关键开关**: False 时模型自行计算 encoder KV，True 时从 past_key_values 读取。搞反会导致 Reshape 错误。
2. **`forced_bos_token_id`**: NLLB 需要在第一步强制输出目标语言 token（如 `jpn_Jpan=256080`），否则会输出错误语言。
3. **encoder KV 形状**: `present.*encoder.key` shape = (1, 16, 4, 64)（4 = 输入序列长度），解码时每步都会重新输出完整的 encoder KV。
4. **Decoder 是 12 层**: 每层 4 个 KV tensor（decoder.key, decoder.value, encoder.key, encoder.value）× 16 heads × 64 dim。

## 测试方法

### Python 依赖

```bash
pip3 install optimum onnxruntime transformers sentencepiece torch
```

### 测试脚本

位于 `scripts/test_nllb_translation.py`，三种用法：

**1. 默认批量测试**（中↔日双向）:

```bash
python3 scripts/test_nllb_translation.py
```

输出示例：
```
模型路径: ~/.cache/chordvox/translation-models/nllb-200-distilled-600M
加载 tokenizer...
加载 encoder...
加载 decoder...
模型加载完成 (2.3s)

============================================================
中文 → 日文
============================================================
  你好 → じゃあどうぞ  (1.85s)
  今天天气很好 → 今日は天気が良い  (1.20s)
  ...

日本語 → 中文
============================================================
  こんにちは → 您好  (1.12s)
  ...
```

**2. 翻译单句**:

```bash
# 中→日（默认）
python3 scripts/test_nllb_translation.py --text "你好"

# 日→中
python3 scripts/test_nllb_translation.py --text "こんにちは" --src ja --tgt zh

# 指定其他语言
python3 scripts/test_nllb_translation.py --text "Hello" --src en --tgt zh
```

**3. 交互模式**（持续输入翻译）:

```bash
python3 scripts/test_nllb_translation.py --interactive
```

```
交互模式 (输入 q 退出)
默认: zh → ja
切换方向示例: ja2zh

[zh→ja] > 你好
  → じゃあどうぞ  (1.85s)

[zh→ja] > ja2zh こんにちは
  切换到 ja→zh
  → 您好  (1.12s)

[ja→zh] > q
```

### 支持的语言代码

| 简写 | 完整代码 | 语言 |
|------|----------|------|
| zh | zho_Hans | 中文（简体） |
| ja | jpn_Jpan | 日本語 |
| en | eng_Latn | English |
| ko | kor_Hang | 한국어 |
| fr | fra_Latn | Français |
| de | deu_Latn | Deutsch |
| es | spa_Latn | Español |

### 性能测试

| 方案 | 每句耗时 | 说明 |
|------|---------|------|
| optimum (推荐) | **~0.22s** | IO binding + 优化 KV cache，正常速度 |
| 裸 onnxruntime | ~1-2s | Python 循环管理 48 个 KV tensor 的开销 |
| CoreML encoder | 16.8ms | 和 CPU 16ms 差不多，模型太小无加速效果 |
| 纯 CPU encoder | 16.0ms | 瓶颈在 decoder，不在 encoder |

模型推理本身很快（optimum 下 0.22s/句），裸 onnxruntime 慢是因为 Python 循环管理 KV cache 的开销。不需要 CoreML/Metal 加速。

### 已知问题

- 裸 `onnxruntime` 直接调用 ONNX 会输出垃圾，必须按 optimum 的 KV cache 逻辑管理缓存（测试脚本已修正）
- 首次加载模型约 2-3 秒，之后常驻内存，每句翻译约 0.2 秒（optimum）
- 之前的 `opus-mt-zh-ja` 模型已损坏，应删除
- CoreML 对 merged decoder 有兼容性问题（Reshape 错误），不适合此模型

## 之前的 OPUS-MT 模型问题

项目原有的 `opus-mt-zh-ja` 模型（位于 `~/.cache/chordvox/translation-models/opus-mt-zh-ja/`）已确认损坏：
- `vocab.json` 与 `source.spm` 来源不匹配（vocab.json 是旧版共享词表，sentencepiece 是新版独立词表）
- ONNX decoder 输出无限循环垃圾 token，永远不会生成 EOS
- 该模型应删除

## 集成方案选项

### 方案 A: Python 子进程 + optimum

**实现方式**: Node.js (Electron) 通过 `child_process` 调用 Python 脚本，Python 用 `optimum` 运行 ONNX 推理。

**优点**:
- 最简单，翻译质量有保证
- `optimum` 库处理所有 KV cache 细节
- 可直接用 `transformers` + `optimum` 的完整生态

**缺点**:
- 依赖 Python 运行时（~200MB）
- 需要安装 `optimum`、`onnxruntime`、`transformers` 等包
- IPC 通信有少量开销

**参考代码**:
```python
# translation_server.py
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer
import json, sys

model_dir = '/path/to/nllb-200-distilled-600M'
model = ORTModelForSeq2SeqLM.from_pretrained(model_dir, subfolder='onnx')
tokenizer = AutoTokenizer.from_pretrained(model_dir)

def translate(text, src_lang, tgt_lang):
    tokenizer.src_lang = src_lang
    tgt_id = tokenizer.convert_tokens_to_ids(tgt_lang)
    inputs = tokenizer(text, return_tensors='pt')
    output = model.generate(**inputs, max_length=512, forced_bos_token_id=tgt_id)
    return tokenizer.decode(output[0], skip_special_tokens=True)

# stdin/stdout JSON IPC
for line in sys.stdin:
    req = json.loads(line)
    result = translate(req['text'], req['src'], req['tgt'])
    print(json.dumps({'result': result}), flush=True)
```

### 方案 B: Node.js 纯 onnxruntime + 移植 KV cache 逻辑

**实现方式**: 用 `onnxruntime-node` 直接加载 ONNX 模型，在 JS 中实现 optimum 的 KV cache 管理。

**优点**:
- 无 Python 依赖
- 打包后更轻量
- 与现有 `onnxruntime-node` 集成一致

**缺点**:
- 需要完整移植 optimum 的 KV cache 逻辑（约 200 行 JS）
- 首次推理和后续推理的 `use_cache_branch` + KV 形状管理较复杂
- 需要处理 merged decoder 的 48 个 KV tensor 的传递
- 测试和调试工作量大

**关键实现要点**:
```javascript
// 伪代码
function translate(text, srcLang, tgtLang) {
  const inputIds = tokenize(text, srcLang);
  const encOut = encoderSession.run({ input_ids, attention_mask });
  const hiddenStates = encOut.last_hidden_state;

  // Step 1: decoder_start=</s>, use_cache_branch=false, 空 KV
  const emptyKV = new Float32Array(1 * 16 * 0 * 64);
  const feed1 = {
    input_ids: new BigInt64Array([2n]),  // </s>
    encoder_hidden_states: hiddenStates,
    encoder_attention_mask: attentionMask,
    use_cache_branch: new Uint8Array([0]),
    ...Object.fromEntries(kvInputNames.map(n => [n, emptyKV]))
  };
  const out1 = decoderSession.run(feed1);
  const presentKV = extractPresentKV(out1);  // 48 个 tensor

  // 强制输出目标语言 token
  let nextToken = langTokenIds[tgtLang];
  const generated = [nextToken];

  // Step 2+: use_cache_branch=true, 传入 present KV
  for (let step = 0; step < maxLen; step++) {
    const feed = {
      input_ids: new BigInt64Array([BigInt(nextToken)]),
      encoder_hidden_states: hiddenStates,
      encoder_attention_mask: attentionMask,
      use_cache_branch: new Uint8Array([1]),
      ...renamePresentToPast(presentKV)  // present.* → past_key_values.*
    };
    const out = decoderSession.run(feed);
    nextToken = argmax(out.logits);
    if (nextToken === EOS) break;
    generated.push(nextToken);
    presentKV = extractPresentKV(out);
  }

  return detokenize(generated);
}
```

### 方案 C: 整合现有的翻译功能 + optium IPC

在现有 `translationInference.js` 中增加对 Python 后端的支持，保留 ONNX runtime 作为备选。

## 推荐

**短期**: 方案 A（Python 子进程），快速验证并上线中日翻译功能。

**长期**: 方案 B（纯 Node.js），消除 Python 依赖，但需要投入时间正确移植 KV cache 逻辑。
