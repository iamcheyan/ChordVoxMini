import os
import sys
import json
import onnxruntime as ort
from transformers import AutoTokenizer
import numpy as np

def test_translation():
    # 模型路径
    model_dir = os.path.expanduser("~/.cache/chordvox/translation-models/opus-mt-zh-ja")
    encoder_path = os.path.join(model_dir, "encoder_model.onnx")
    decoder_path = os.path.join(model_dir, "decoder_model.onnx")
    
    print(f"正在加载模型: {model_dir}")
    
    if not os.path.exists(encoder_path) or not os.path.exists(decoder_path):
        print(f"错误: 找不到模型文件！请确保文件在: {model_dir}")
        return

    # 加载分词器
    # 注意：虽然我们在应用里改用了 vocab.json，但在 Python 里 AutoTokenizer 仍然能识别该目录
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_dir)
        print("分词器加载成功")
    except Exception as e:
        print(f"分词器加载失败: {e}")
        print("尝试从 HuggingFace 远程加载分词器配置...")
        tokenizer = AutoTokenizer.from_pretrained("Helsinki-NLP/opus-mt-zh-ja")

    # 准备输入
    text = "你好"
    print(f"\n输入中文: {text}")

    inputs = tokenizer(text, return_tensors="np")
    input_ids = inputs["input_ids"].astype(np.int64)
    attention_mask = inputs["attention_mask"].astype(np.int64)

    # 创建 ORT 会话
    providers = ["CPUExecutionProvider"]
    encoder_session = ort.InferenceSession(encoder_path, providers=providers)
    decoder_session = ort.InferenceSession(decoder_path, providers=providers)

    # 1. 运行 Encoder
    encoder_outputs = encoder_session.run(None, {
        "input_ids": input_ids,
        "attention_mask": attention_mask
    })
    last_hidden_state = encoder_outputs[0]

    # 2. 贪婪搜索解码 (Greedy Search Decoding)
    # 起始符通常是 tokenizer.pad_token_id 或 58100
    decoder_input_ids = np.array([[tokenizer.pad_token_id]], dtype=np.int64)
    
    max_length = 50
    generated_tokens = []

    print("正在生成翻译...")
    for _ in range(max_length):
        # 运行 Decoder
        # 注意：这里需要传入 encoder_attention_mask，这是 MarianMT ONNX 模型的常见要求
        decoder_outputs = decoder_session.run(None, {
            "input_ids": decoder_input_ids,
            "encoder_hidden_states": last_hidden_state,
            "encoder_attention_mask": attention_mask
        })
        
        logits = decoder_outputs[0]
        next_token_id = np.argmax(logits[:, -1, :], axis=-1)[0]
        
        if next_token_id == tokenizer.eos_token_id:
            break
            
        generated_tokens.append(next_token_id)
        decoder_input_ids = np.concatenate([decoder_input_ids, [[next_token_id]]], axis=-1)

    # 3. 解码输出
    result = tokenizer.decode(generated_tokens, skip_special_tokens=True)
    print(f"\n输出日语: {result}")
    print("\n测试完成！")

if __name__ == "__main__":
    test_translation()
