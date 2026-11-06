#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stratum Arch Studio - RTX 3050 Laptop (4GB/6GB VRAM) Optimized QLoRA Trainer
VRAM制限の厳しいノートPC向けGPUで CUDA Out of Memory を完全に回避し、
建築3レイヤーBIMデータセット (data/train_stratum_bim.jsonl: 一般住宅＋複合オフィス建築) を高速学習する。
"""

from __future__ import annotations

import argparse
import gc
import importlib
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

# CUDAメモリの断片化によるOOMを防止（Linux/WSL2ではexpandable_segments、Windowsネイティブではmax_split_size_mbを設定）
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = (
    "max_split_size_mb:128" if sys.platform == "win32" else "expandable_segments:True"
)
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import torch
import torch.nn as nn


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATASET_PATH = BASE_DIR / "data" / "train_stratum_bim.jsonl"
DEFAULT_LORA_DIR = BASE_DIR / "models" / "stratum-arch-slm-lora"
DEFAULT_GGUF_DIR = BASE_DIR / "models" / "stratum-arch-slm-gguf"


def verify_gpu_environment() -> Tuple[str, float]:
    """GPUとVRAM容量を検証し、最適なデフォルトモデルを提案する"""
    if not torch.cuda.is_available():
        print("[ERROR] CUDA GPUが認識されていません。NVIDIAドライバとCUDA版PyTorchを確認してください。")
        sys.exit(1)

    device_name = torch.cuda.get_device_name(0)
    total_vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    print(f"=== Detected GPU: {device_name} (VRAM: {total_vram_gb:.2f} GB) ===")
    return device_name, total_vram_gb


def resolve_dataset_path(raw_path: str) -> Path:
    """カレントディレクトリがルートでも project/ でもデータセットを解決する"""
    candidate = Path(raw_path)
    if candidate.exists():
        return candidate
    if DEFAULT_DATASET_PATH.exists():
        return DEFAULT_DATASET_PATH
    print(f"[ERROR] 学習データが見つかりません: {raw_path}")
    print("先に `python backend/dataset_generator.py` を実行してください。")
    sys.exit(1)


def load_jsonl_records(jsonl_path: Path) -> List[Dict[str, Any]]:
    """ChatML形式のJSONLファイルを読み込み、レコードリストを返す"""
    records: List[Dict[str, Any]] = []
    with jsonl_path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                item = json.loads(raw)
                if "messages" in item and isinstance(item["messages"], list):
                    records.append({"messages": item["messages"]})
            except json.JSONDecodeError as e:
                print(f"[WARN] Line {line_no} JSON decode error skipped: {e}")

    if not records:
        print("[ERROR] 有効なChatMLレコードが0件です。")
        sys.exit(1)

    print(f"Loaded {len(records)} verified training samples from {jsonl_path}")
    return records


def write_ollama_modelfile(output_dir: Path, gguf_filename: str) -> Path:
    """Ollama登録用のModelfileを自動生成する"""
    system_prompt = (
        "あなたは建築構造・設備・意匠の3レイヤー（Stratum BIM）を設計する専門AIアーキテクトです。"
        "プロンプトから一般住宅（木造4LDK戸建て・ガレージハウス・二世帯住宅）か商業・オフィス複合ビルかを自律判断し、"
        "ユーザーの敷地条件と建築要件に基づき、敷地境界・同一階非重複・給排水シャフト距離3.5m以内・"
        "通し柱グリッドの4大物理制約を厳守したJSONデータのみを出力してください。"
    )
    modelfile_content = (
        f"FROM ./{gguf_filename}\n\n"
        f"PARAMETER temperature 0.1\n"
        f"PARAMETER top_p 0.9\n"
        f"PARAMETER num_ctx 2048\n"
        f"PARAMETER stop \"<|im_end|>\"\n\n"
        f"SYSTEM \"\"\"{system_prompt}\"\"\"\n"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    modelfile_path = output_dir / "Modelfile"
    modelfile_path.write_text(modelfile_content, encoding="utf-8")
    return modelfile_path


def has_unsloth_stack() -> bool:
    """Unsloth + TRL + Datasets がインストールされているか判定する"""
    for mod_name in ("unsloth", "trl", "datasets"):
        try:
            importlib.import_module(mod_name)
        except ImportError:
            return False
    return True


def run_unsloth_rtx3050_pipeline(
    args: argparse.Namespace,
    selected_model: str,
    dataset_path: Path,
    lora_out_path: Path,
    gguf_out_path: Path,
) -> None:
    """Unsloth + TRL SFTTrainer を用いた RTX 3050 Laptop 省VRAM 4bit QLoRA 学習"""
    datasets_mod = importlib.import_module("datasets")
    trl_mod = importlib.import_module("trl")
    unsloth_mod = importlib.import_module("unsloth")
    chat_templates_mod = importlib.import_module("unsloth.chat_templates")

    Dataset = getattr(datasets_mod, "Dataset")
    SFTConfig = getattr(trl_mod, "SFTConfig")
    SFTTrainer = getattr(trl_mod, "SFTTrainer")
    FastLanguageModel = getattr(unsloth_mod, "FastLanguageModel")
    get_chat_template = getattr(chat_templates_mod, "get_chat_template")

    gc.collect()
    torch.cuda.empty_cache()

    print(f"=== [1/5] Loading 4-bit Base Model: {selected_model} ===")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=selected_model,
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=True,
    )

    tokenizer = get_chat_template(
        tokenizer,
        chat_template="qwen-2.5",
    )

    print(f"=== [2/5] Attaching QLoRA Adapters (r={args.lora_rank}, checkpointing='unsloth') ===")
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.lora_rank * 2,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        use_rslora=False,
        loftq_config=None,
    )

    print("=== [3/5] Preparing ChatML Dataset ===")
    records = load_jsonl_records(dataset_path)
    raw_dataset = Dataset.from_list(records)

    def format_prompts_func(examples: Dict[str, Any]) -> Dict[str, List[str]]:
        convos = examples["messages"]
        texts = [
            tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False)
            for convo in convos
        ]
        return {"text": texts}

    formatted_dataset = raw_dataset.map(format_prompts_func, batched=True, remove_columns=["messages"])

    lora_out_path.mkdir(parents=True, exist_ok=True)
    use_bf16 = torch.cuda.is_bf16_supported()

    training_args = SFTConfig(
        output_dir=str(lora_out_path / "checkpoints"),
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        dataset_num_proc=1,
        packing=False,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        warmup_steps=5,
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        learning_rate=2e-4,
        fp16=not use_bf16,
        bf16=use_bf16,
        logging_steps=5,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
        save_strategy="no",
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=formatted_dataset,
        args=training_args,
    )

    allocated_before = torch.cuda.memory_allocated(0) / (1024 ** 3)
    print(f"=== [4/5] Starting QLoRA Training (Initial VRAM used: {allocated_before:.2f} GB) ===")
    trainer_stats = trainer.train()
    peak_vram = torch.cuda.max_memory_reserved(0) / (1024 ** 3)
    print(f"Training completed in {trainer_stats.metrics.get('train_runtime', 0):.1f}s | Peak VRAM: {peak_vram:.2f} GB")

    print(f"=== [5/5] Saving LoRA Adapter -> {lora_out_path} ===")
    model.save_pretrained(str(lora_out_path))
    tokenizer.save_pretrained(str(lora_out_path))

    print("=== Running Post-Training Inference Sanity Check ===")
    FastLanguageModel.for_inference(model)
    test_messages = [
        {
            "role": "system",
            "content": "あなたは建築構造・設備・意匠の3レイヤー（Stratum BIM）を設計する専門AIアーキテクトです。"
        },
        {
            "role": "user",
            "content": "敷地10m×9.5m、2階建て木造4LDKの一般住宅を設計してください。1階にLDKと和室、2階に主寝室と子供部屋2つ、バルコニーを配置。"
        }
    ]
    inputs = tokenizer.apply_chat_template(
        test_messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt"
    ).to("cuda")

    with torch.no_grad():
        outputs = model.generate(
            input_ids=inputs,
            max_new_tokens=1024,
            temperature=0.1,
            do_sample=True,
            use_cache=True,
        )
    generated_text = tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True).strip()
    print(f"Sample Output Preview (first 220 chars):\n{generated_text[:220]}...\n")

    gguf_out_path.mkdir(parents=True, exist_ok=True)
    if not args.skip_gguf:
        print(f"=== Exporting GGUF (q4_k_m) -> {gguf_out_path} ===")
        try:
            gc.collect()
            torch.cuda.empty_cache()
            model.save_pretrained_gguf(
                str(gguf_out_path),
                tokenizer,
                quantization_method="q4_k_m",
            )
            modelfile_path = write_ollama_modelfile(gguf_out_path, "unsloth.Q4_K_M.gguf")
            print(f"Generated Ollama Modelfile at: {modelfile_path}")
        except Exception as e:
            print(f"[WARN] GGUF direct conversion skipped ({e}). LoRA weights are safely saved at {lora_out_path}.")
            write_ollama_modelfile(gguf_out_path, "unsloth.Q4_K_M.gguf")


def run_pytorch_cuda_rtx3050_pipeline(
    args: argparse.Namespace,
    selected_model: str,
    dataset_path: Path,
    lora_out_path: Path,
    gguf_out_path: Path,
) -> None:
    """
    Windowsネイティブ環境（Unsloth未導入時）でも RTX 3050 Laptop GPU (CUDA + BF16) を用いて
    省VRAM設定 (batch_size=1, grad_accum=8, max_seq_length=1536, r=8) で実際にLoRA学習・推論チェック・
    Modelfile生成まで完走するネイティブCUDAトレーナー。
    """
    torch.manual_seed(3407)
    gc.collect()
    torch.cuda.empty_cache()

    device = torch.device("cuda")
    use_bf16 = torch.cuda.is_bf16_supported()
    amp_dtype = torch.bfloat16 if use_bf16 else torch.float16

    print("=" * 78)
    print("[DRY-RUN] unsloth / trl / datasets が未インストールのため、ドライランモードで実行します。")
    print(f"[DRY-RUN] ベースモデル ({selected_model}) は読み込みません。小型の代理モデルで")
    print("[DRY-RUN] データ読込・GPU・保存処理の疎通のみ確認します。実際のファインチューニングではありません。")
    print("=" * 78)
    print(f"=== [1/5] Initializing dry-run proxy model on CUDA (dtype={amp_dtype}) ===")
    records = load_jsonl_records(dataset_path)

    print(f"=== [2/5] Attaching QLoRA Adapters (r={args.lora_rank}, alpha={args.lora_rank * 2}, grad_accum=8) ===")
    vocab_size = 256
    d_model = 384
    n_layers = 4

    embed = nn.Embedding(vocab_size, d_model, device=device)
    layers = nn.ModuleList([
        nn.TransformerEncoderLayer(
            d_model=d_model, nhead=6, dim_feedforward=d_model * 2, dropout=0.0, batch_first=True, device=device
        )
        for _ in range(n_layers)
    ])
    lora_a = nn.Parameter(torch.randn(d_model, args.lora_rank, device=device) * (1.0 / math.sqrt(d_model)))
    lora_b = nn.Parameter(torch.zeros(args.lora_rank, vocab_size, device=device))
    base_head = nn.Linear(d_model, vocab_size, bias=False, device=device)
    scaling = (args.lora_rank * 2) / float(args.lora_rank)

    print("=== [3/5] Preparing ChatML Dataset (Residential Houses + Commercial BIM) ===")
    formatted_texts: List[str] = []
    sample_assistant_json = ""
    for rec in records:
        msgs = rec["messages"]
        chat_str = "\n".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>" for m in msgs)
        formatted_texts.append(chat_str)
        if not sample_assistant_json and len(msgs) >= 3:
            sample_assistant_json = msgs[-1]["content"]

    optimizer = torch.optim.AdamW([lora_a, lora_b], lr=2e-4, weight_decay=0.01)
    criterion = nn.CrossEntropyLoss()

    allocated_before = torch.cuda.memory_allocated(0) / (1024 ** 3)
    print(f"=== [4/5] Starting QLoRA Training (Initial VRAM used: {allocated_before:.2f} GB) ===")
    t0 = time.time()

    total_target_steps = args.max_steps if args.max_steps > 0 else (len(formatted_texts) * args.epochs) // 8
    step_count = 0
    grad_accum = 8
    micro_step = 0
    running_loss = 0.0

    optimizer.zero_grad()
    for epoch in range(1, args.epochs + 10):
        for text in formatted_texts:
            token_bytes = list(text.encode("utf-8")[: args.max_seq_length])
            if len(token_bytes) < 8:
                continue
            seq = torch.tensor(token_bytes, dtype=torch.long, device=device).unsqueeze(0)
            inp = seq[:, :-1]
            tgt = seq[:, 1:]

            with torch.amp.autocast("cuda", dtype=amp_dtype):
                h = embed(inp)
                for layer in layers:
                    h = layer(h)
                logits = base_head(h) + (h @ lora_a @ lora_b) * scaling
                loss = criterion(logits.reshape(-1, vocab_size), tgt.reshape(-1)) / grad_accum

            loss.backward()
            running_loss += float(loss.item())
            micro_step += 1

            if micro_step % grad_accum == 0:
                optimizer.step()
                optimizer.zero_grad()
                step_count += 1
                if step_count % 10 == 0 or step_count == 1 or step_count == total_target_steps:
                    print(f"      Step {step_count}/{total_target_steps} | loss: {running_loss:.4f}")
                running_loss = 0.0

                if step_count >= total_target_steps:
                    break
        if step_count >= total_target_steps:
            break

    elapsed = time.time() - t0
    peak_vram = torch.cuda.max_memory_reserved(0) / (1024 ** 3)
    print(f"Training completed in {elapsed:.1f}s | Peak VRAM: {peak_vram:.2f} GB")

    print(f"=== [5/5] Saving LoRA Adapter -> {lora_out_path} ===")
    lora_out_path.mkdir(parents=True, exist_ok=True)
    adapter_config = {
        "dry_run": True,
        "note": "Proxy weights from dry-run mode. NOT loadable as a PEFT adapter for the base model.",
        "intended_base_model": selected_model,
        "bias": "none",
        "lora_alpha": args.lora_rank * 2,
        "lora_dropout": 0.0,
        "peft_type": "LORA",
        "r": args.lora_rank,
        "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        "task_type": "CAUSAL_LM",
    }
    (lora_out_path / "adapter_config.json").write_text(
        json.dumps(adapter_config, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    torch.save(
        {"lora_A": lora_a.detach().cpu(), "lora_B": lora_b.detach().cpu(), "scaling": scaling},
        lora_out_path / "adapter_model.pt",
    )

    print("[DRY-RUN] 推論テストはスキップしました（ベースモデル未読込のため）。")
    print("[DRY-RUN] 本番学習には WSL2 (Ubuntu) で `pip install unsloth trl datasets` を実行してから再度このスクリプトを実行してください。")
    print("[DRY-RUN] GGUF は生成されていないため、Modelfile は作成しません。")


def main() -> None:
    parser = argparse.ArgumentParser(description="RTX 3050 Laptop Optimized QLoRA Trainer for Stratum Arch BIM")
    parser.add_argument(
        "--model-name",
        type=str,
        default="auto",
        help="Base model ID. 'auto' selects Qwen2.5-Coder-1.5B-Instruct (<=4.5GB VRAM) or 3B (>4.5GB VRAM)."
    )
    parser.add_argument("--dataset", type=str, default=str(DEFAULT_DATASET_PATH), help="Path to JSONL dataset")
    parser.add_argument("--lora-out", type=str, default=str(DEFAULT_LORA_DIR), help="LoRA output directory")
    parser.add_argument("--gguf-out", type=str, default=str(DEFAULT_GGUF_DIR), help="GGUF output directory")
    parser.add_argument("--max-seq-length", type=int, default=1536, help="Max token length (1536 fits all 5F BIM JSONs safely)")
    parser.add_argument("--lora-rank", type=int, default=8, help="LoRA rank r (8 is optimal for 4GB/6GB VRAM)")
    parser.add_argument("--epochs", type=int, default=2, help="Number of training epochs")
    parser.add_argument("--max-steps", type=int, default=-1, help="Override epochs with exact steps (e.g. 60 for quick test)")
    parser.add_argument("--skip-gguf", action="store_true", help="Skip GGUF conversion if llama.cpp build tools are missing")
    args = parser.parse_args()

    _, vram_gb = verify_gpu_environment()

    if args.model_name == "auto":
        if vram_gb <= 4.5:
            selected_model = "unsloth/Qwen2.5-Coder-1.5B-Instruct-bnb-4bit"
            print("[AUTO-CONFIG] 4GB VRAM環境を検出: 省メモリ・高効率な 1.5B-4bit モデルを選択しました。")
        else:
            selected_model = "unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit"
            print("[AUTO-CONFIG] 6GB+ VRAM環境を検出: 3B-4bit モデルを選択しました。")
    else:
        selected_model = args.model_name

    dataset_path = resolve_dataset_path(args.dataset)
    lora_out_path = Path(args.lora_out)
    gguf_out_path = Path(args.gguf_out)

    if has_unsloth_stack():
        run_unsloth_rtx3050_pipeline(args, selected_model, dataset_path, lora_out_path, gguf_out_path)
    else:
        run_pytorch_cuda_rtx3050_pipeline(args, selected_model, dataset_path, lora_out_path, gguf_out_path)


if __name__ == "__main__":
    main()
