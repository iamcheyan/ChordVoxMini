"""
NLLB-200 中日翻译模型测试脚本 (使用 Optimum 库)

用法:
    python3 scripts/test_nllb_translation.py
    python3 scripts/test_nllb_translation.py --text "你好" --src zh --tgt ja
    python3 scripts/test_nllb_translation.py --interactive
    python3 scripts/test_nllb_translation.py --text "你好" --source zh --target ja
"""

import argparse
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore", category=UserWarning)

MODEL_DIR = os.path.expanduser("~/.cache/chordvox/translation-models/nllb-200-distilled-600M")

LANG_MAP = {
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "en": "eng_Latn",
    "ko": "kor_Hang",
    "fr": "fra_Latn",
    "de": "deu_Latn",
    "es": "spa_Latn",
}


def load_model():
    from optimum.onnxruntime import ORTModelForSeq2SeqLM
    from transformers import AutoTokenizer

    if not os.path.exists(MODEL_DIR):
        print(f"[error] model not found: {MODEL_DIR}", file=sys.stderr)
        sys.exit(1)

    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = ORTModelForSeq2SeqLM.from_pretrained(MODEL_DIR, subfolder="onnx")
    return tok, model


def translate(text, src_lang, tgt_lang, tok, model):
    src_code = LANG_MAP.get(src_lang, src_lang)
    tgt_code = LANG_MAP.get(tgt_lang, tgt_lang)

    tok.src_lang = src_code
    forced_bos_token_id = tok.convert_tokens_to_ids(tgt_code)
    inputs = tok(text, return_tensors="pt")

    t0 = time.time()
    outputs = model.generate(**inputs, max_length=512, forced_bos_token_id=forced_bos_token_id)
    elapsed = time.time() - t0

    result = tok.decode(outputs[0], skip_special_tokens=True)
    return result, elapsed


def main():
    parser = argparse.ArgumentParser(description="NLLB-200 translation test")
    parser.add_argument("--text", type=str, help="text to translate")
    parser.add_argument("--src", type=str, default="zh", help="source language (zh/ja/en/...)")
    parser.add_argument("--tgt", type=str, default="ja", help="target language (zh/ja/en/...)")
    parser.add_argument("--source", type=str, default=None, help="source language alias (for IPC)")
    parser.add_argument("--target", type=str, default=None, help="target language alias (for IPC)")
    parser.add_argument("--interactive", action="store_true", help="interactive mode")
    args = parser.parse_args()

    # Support both --src/--tgt and --source/--target (for IPC compatibility)
    src = args.source or args.src
    tgt = args.target or args.tgt

    tok, model = load_model()

    if args.interactive:
        print(f"Interactive mode (q to quit). Default: {src} -> {tgt}")
        while True:
            try:
                line = input(f"[{src}->{tgt}] > ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if line == "q":
                break
            if "2" in line:
                parts = line.split(" ", 1)
                lang_part = parts[0]
                if "2" in lang_part:
                    src, tgt = lang_part.split("2")
                    text = parts[1] if len(parts) > 1 else ""
                    if not text:
                        print(f"Switched to {src} -> {tgt}")
                        continue
                else:
                    text = line
            else:
                text = line
            if not text:
                continue
            result, elapsed = translate(text, src, tgt, tok, model)
            print(f"Result: {result} ({elapsed:.2f}s)")

    elif args.text:
        result, elapsed = translate(args.text, src, tgt, tok, model)
        print(f"Result: {result} ({elapsed:.2f}s)")

    else:
        tests = [
            ("zh", "ja", "你好"),
            ("zh", "ja", "今天天气很好"),
            ("zh", "ja", "我想去日本旅游"),
            ("ja", "zh", "こんにちは"),
            ("ja", "zh", "今日はいい天気です"),
            ("ja", "zh", "ありがとうございます"),
        ]
        for s, t, text in tests:
            result, elapsed = translate(text, s, t, tok, model)
            print(f"[{s}->{t}] {text} -> {result} ({elapsed:.2f}s)")


if __name__ == "__main__":
    main()
