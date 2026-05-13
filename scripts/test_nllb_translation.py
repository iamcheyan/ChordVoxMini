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
    import onnxruntime as ort

    if not os.path.exists(MODEL_DIR):
        print(f"[error] model not found: {MODEL_DIR}", file=sys.stderr)
        sys.exit(1)

    # Detect Apple Silicon and try CoreML
    providers = ["CPUExecutionProvider"]
    available_providers = ort.get_available_providers()
    if "CoreMLExecutionProvider" in available_providers:
        # CoreML is available
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]

    print(f"[info] Loading model from {MODEL_DIR} with providers: {providers}", file=sys.stderr)
    
    try:
        tok = AutoTokenizer.from_pretrained(MODEL_DIR)
        model = ORTModelForSeq2SeqLM.from_pretrained(
            MODEL_DIR, 
            subfolder="onnx",
            provider=providers[0] if len(providers) > 0 else None
        )
        return tok, model
    except Exception as e:
        print(f"[error] Failed to load model: {e}", file=sys.stderr)
        # Fallback to CPU if CoreML fails
        if "CoreML" in str(e):
            print("[info] CoreML failed, falling back to CPU...", file=sys.stderr)
            tok = AutoTokenizer.from_pretrained(MODEL_DIR)
            model = ORTModelForSeq2SeqLM.from_pretrained(MODEL_DIR, subfolder="onnx", provider="CPUExecutionProvider")
            return tok, model
        raise e


def translate(text, src_lang, tgt_lang, tok, model):
    src_code = LANG_MAP.get(src_lang, src_lang)
    tgt_code = LANG_MAP.get(tgt_lang, tgt_lang)

    tok.src_lang = src_code
    # NLLB needs the target language code as the forced BOS token
    forced_bos_token_id = tok.convert_tokens_to_ids(tgt_code)
    inputs = tok(text, return_tensors="pt")

    t0 = time.time()
    outputs = model.generate(**inputs, max_length=512, forced_bos_token_id=forced_bos_token_id)
    elapsed = time.time() - t0

    result = tok.decode(outputs[0], skip_special_tokens=True)
    return result, elapsed


def main():
    parser = argparse.ArgumentParser(description="NLLB-200 translation service")
    parser.add_argument("--text", type=str, help="text to translate")
    parser.add_argument("--src", type=str, default="zh", help="source language")
    parser.add_argument("--tgt", type=str, default="ja", help="target language")
    parser.add_argument("--source", type=str, default=None, help="source language alias")
    parser.add_argument("--target", type=str, default=None, help="target language alias")
    parser.add_argument("--interactive", action="store_true", help="interactive mode")
    parser.add_argument("--listen", action="store_true", help="JSON listening mode for IPC")
    args = parser.parse_args()

    src = args.source or args.src
    tgt = args.target or args.tgt

    tok, model = load_model()
    
    # Signal readiness to the parent process
    print("[ready] Translation model loaded", file=sys.stderr)

    if args.listen:
        import json
        # Continuous loop for IPC
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                
                data = json.loads(line)
                text = data.get("text", "").strip()
                s_lang = data.get("src", src)
                t_lang = data.get("tgt", tgt)
                
                if not text:
                    print(json.dumps({"success": True, "text": ""}))
                    sys.stdout.flush()
                    continue
                
                result, elapsed = translate(text, s_lang, t_lang, tok, model)
                print(json.dumps({
                    "success": True,
                    "text": result,
                    "elapsed": elapsed
                }))
                sys.stdout.flush()
                
            except json.JSONDecodeError:
                continue
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}))
                sys.stdout.flush()

    elif args.interactive:
        print(f"Interactive mode (q to quit). Default: {src} -> {tgt}")
        while True:
            try:
                line = input(f"[{src}->{tgt}] > ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if line == "q":
                break
            if not line:
                continue
            result, elapsed = translate(line, src, tgt, tok, model)
            print(f"Result: {result} ({elapsed:.2f}s)")

    elif args.text:
        result, elapsed = translate(args.text, src, tgt, tok, model)
        print(f"Result: {result} ({elapsed:.2f}s)")


if __name__ == "__main__":
    main()
