#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stratum Arch Studio - ワンコマンド一括起動＆ヘルスチェックスクリプト (start_studio.py)

機能:
  1. 既存のポート8000 (FastAPI) / ポート5173 (Vite) の古いプロセスがあれば安全に停止
  2. バックエンド (FastAPI: http://127.0.0.1:8000) をバックグラウンド起動
  3. フロントエンド (Vite: http://localhost:5173) をバックグラウンド起動
  4. 両サーバーのHTTP応答 (/api/health, /api/generate-from-spec, フロントエンドHTML) を自動検証
  5. 正常稼働を確認後、既定のブラウザで http://localhost:5173 を自動で開く

使い方:
  起動: python start_studio.py
  停止: python start_studio.py --stop
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


def resolve_paths() -> tuple[Path, Path]:
    """スクリプトの位置からワークスペースルートと project ディレクトリを特定する"""
    here = Path(__file__).resolve().parent
    if (here / "package.json").exists() and (here / "ai_bim_3d.tsx").exists():
        project_dir = here
        root_dir = here.parent if (here.parent / "backend").exists() else here
    else:
        root_dir = here
        project_dir = here / "project"
    return root_dir, project_dir


def kill_port_on_windows(port: int) -> None:
    """指定ポートを使用中のプロセス（および親リローダープロセス）をロケール非依存で停止する"""
    if sys.platform != "win32":
        return
    try:
        out = subprocess.check_output(
            ["netstat", "-ano", "-p", "TCP"],
            text=True,
            encoding="cp932",
            errors="ignore",
        )
        pids: set[int] = set()
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[1].endswith(f":{port}"):
                try:
                    pid = int(parts[-1])
                    if pid > 0 and pid != os.getpid():
                        pids.add(pid)
                except ValueError:
                    pass
        for pid in pids:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
    except Exception:
        pass


def wait_for_http(url: str, timeout_sec: float = 20.0) -> bool:
    """指定URLがHTTP 200を返すまでポーリング待機する"""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as resp:
                if 200 <= resp.status < 400:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def verify_spec_api(api_base: str) -> bool:
    """/api/generate-from-spec エンドポイントが3案を正常に返すか確認する"""
    url = f"{api_base}/api/generate-from-spec"
    payload = json.dumps({
        "building_type": "family_house",
        "width": 10.0,
        "depth": 9.5,
        "floors": 2,
        "orientation": "northeast",
        "variants": 3,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return len(data.get("variants", [])) == 3
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Start or stop Stratum Arch Studio servers.")
    parser.add_argument("--stop", action="store_true", help="Stop running backend (8000) and frontend (5173) servers")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")
    args = parser.parse_args()

    root_dir, project_dir = resolve_paths()
    log_dir = root_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)

    print("=== Stopping any existing processes on ports 8000 & 5173 ===")
    kill_port_on_windows(8000)
    kill_port_on_windows(5173)

    if args.stop:
        print("[OK] Stopped backend (8000) and frontend (5173) servers.")
        return

    time.sleep(0.5)

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS

    # 1. バックエンド (FastAPI) のバックグラウンド起動
    backend_log_path = log_dir / "backend.log"
    backend_log = backend_log_path.open("w", encoding="utf-8")
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.server:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
    ]
    print(f"=== [1/3] Starting FastAPI Backend on http://127.0.0.1:8000 ===")
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(root_dir),
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    # 2. フロントエンド (Vite) のバックグラウンド起動
    frontend_log_path = log_dir / "frontend.log"
    frontend_log = frontend_log_path.open("w", encoding="utf-8")
    npm_exe = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_cmd = [npm_exe, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]
    print(f"=== [2/3] Starting Vite Frontend on http://localhost:5173 ===")
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=str(project_dir),
        stdout=frontend_log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    # 3. 稼働確認 (Health Check)
    print("=== [3/3] Verifying Backend & Frontend Health ===")
    backend_ok = wait_for_http("http://127.0.0.1:8000/api/health", timeout_sec=20.0)
    spec_ok = verify_spec_api("http://127.0.0.1:8000") if backend_ok else False
    frontend_ok = wait_for_http("http://127.0.0.1:5173", timeout_sec=20.0)

    print(f"  - FastAPI Health (/api/health)            : {'OK' if backend_ok else 'FAILED'} (PID: {backend_proc.pid})")
    print(f"  - Spec Solver (/api/generate-from-spec)   : {'OK (3 variants verified)' if spec_ok else 'FAILED'}")
    print(f"  - Vite Dev Server (http://localhost:5173) : {'OK' if frontend_ok else 'FAILED'} (PID: {frontend_proc.pid})")
    print(f"  - Logs saved in                           : {log_dir}")

    if not (backend_ok and frontend_ok):
        print("[WARN] サーバーの起動確認に失敗しました。logs/ 内のログファイルを確認してください。")
        sys.exit(1)

    target_url = "http://localhost:5173"
    if not args.no_browser:
        print(f"=== Opening Browser: {target_url} ===")
        webbrowser.open(target_url)

    print("\n[READY] Stratum Arch Studio is running in the background!")
    print("        Stop anytime with: python start_studio.py --stop")


if __name__ == "__main__":
    main()
