"""
fetch_clips.py
==============
指定した配信者の全クリップを Twitch API から取得し、
clip-search サイト用の JSON ファイルとして保存するスクリプト。

【使い方】
1. Twitch Developer Console でアプリを登録し、
   Client ID と Client Secret を取得する
   → https://dev.twitch.tv/console/apps

2. このスクリプトと同じフォルダに .env ファイルを作成:
   TWITCH_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
   TWITCH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxx

3. 依存ライブラリをインストール:
   pip install requests python-dotenv

4. 実行:
   python fetch_clips.py --channel 配信者のログイン名

   例:
   python fetch_clips.py --channel jinwktk
   python fetch_clips.py --channel jinwktk --output data/clips.json
   python fetch_clips.py --channel jinwktk --started_at 2024-01-01
"""

import os
import sys
import json
import time
import argparse
import requests
from datetime import datetime, timezone
from pathlib import Path

# .env ファイルが存在すれば読み込む（オプション）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv 未インストールでもOK（環境変数で直接設定可）


# ============================================================
#  設定
# ============================================================
TWITCH_API_BASE = "https://api.twitch.tv/helix"
MAX_PER_PAGE    = 100   # Twitch API の 1 ページあたり最大件数
RATE_LIMIT_WAIT = 0.5   # ページ取得間の待機秒数（レート制限対策）


# ============================================================
#  認証トークン取得（Client Credentials Flow）
# ============================================================
def get_access_token(client_id: str, client_secret: str) -> str:
    resp = requests.post(
        "https://id.twitch.tv/oauth2/token",
        params={
            "client_id":     client_id,
            "client_secret": client_secret,
            "grant_type":    "client_credentials",
        },
        timeout=10,
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise RuntimeError("アクセストークンの取得に失敗しました。Client ID / Secret を確認してください。")
    print(f"✅ アクセストークン取得成功")
    return token


# ============================================================
#  ユーザー ID をログイン名から取得
# ============================================================
def get_user_id(channel: str, headers: dict) -> tuple[str, str]:
    resp = requests.get(
        f"{TWITCH_API_BASE}/users",
        params={"login": channel},
        headers=headers,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json().get("data", [])
    if not data:
        raise RuntimeError(f"ユーザー '{channel}' が見つかりません。ログイン名を確認してください。")
    user = data[0]
    print(f"✅ ユーザー確認: {user['display_name']} (ID: {user['id']})")
    return user["id"], user["display_name"]


# ============================================================
#  クリップを全件取得（ページネーション対応）
# ============================================================
def fetch_all_clips(
    broadcaster_id: str,
    headers: dict,
    started_at: str | None = None,
    ended_at:   str | None = None,
    max_clips:  int | None = None,
) -> list[dict]:

    clips   = []
    cursor  = None
    page    = 0

    while True:
        page += 1
        params = {
            "broadcaster_id": broadcaster_id,
            "first": MAX_PER_PAGE,
        }
        if cursor:
            params["after"] = cursor
        if started_at:
            params["started_at"] = started_at
        if ended_at:
            params["ended_at"] = ended_at

        resp = requests.get(
            f"{TWITCH_API_BASE}/clips",
            params=params,
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()

        batch = body.get("data", [])
        if not batch:
            break

        clips.extend(batch)
        print(f"  📦 ページ {page}: {len(batch)} 件取得（累計: {len(clips)} 件）")

        # 上限チェック
        if max_clips and len(clips) >= max_clips:
            clips = clips[:max_clips]
            print(f"  ⚠️  --max_clips {max_clips} に達したので取得を終了します")
            break

        # 次ページ
        cursor = body.get("pagination", {}).get("cursor")
        if not cursor:
            break

        time.sleep(RATE_LIMIT_WAIT)

    return clips


# ============================================================
#  クリップデータをサイト用フォーマットに変換
# ============================================================
def normalize_clip(clip: dict) -> dict:
    # サムネイル URL（720p → 480x270 に変換）
    thumb = clip.get("thumbnail_url", "")
    # Twitch のサムネ URL は末尾が -{width}x{height}.jpg なので差し替え
    thumb = thumb.replace("-{width}x{height}", "-480x270")

    return {
        "id":            clip.get("id", ""),
        "title":         clip.get("title", ""),
        "game":          clip.get("game_id", ""),   # game_name が取れない場合の予備
        "game_name":     clip.get("game_id", ""),   # ※後処理で game_name に置換推奨
        "views":         clip.get("view_count", 0),
        "duration":      round(clip.get("duration", 0)),
        "created_at":    clip.get("created_at", ""),
        "thumbnail_url": thumb,
        "clip_url":      clip.get("url", ""),
        "creator_name":  clip.get("creator_name", ""),
        "language":      clip.get("language", ""),
        "broadcaster_name": clip.get("broadcaster_name", ""),
    }


# ============================================================
#  ゲーム名を game_id から一括取得して埋め込む（オプション）
# ============================================================
def fill_game_names(clips: list[dict], headers: dict) -> list[dict]:
    # 重複を除いた game_id 一覧
    game_ids = list({c["game"] for c in clips if c["game"]})
    if not game_ids:
        return clips

    print(f"\n🎮 ゲーム名を取得中（{len(game_ids)} タイトル）…")
    id_to_name = {}

    # API は 1 リクエストにつき 100 件まで
    for i in range(0, len(game_ids), 100):
        batch = game_ids[i:i+100]
        params = [("id", gid) for gid in batch]
        resp = requests.get(
            f"{TWITCH_API_BASE}/games",
            params=params,
            headers=headers,
            timeout=10,
        )
        if resp.ok:
            for game in resp.json().get("data", []):
                id_to_name[game["id"]] = game["name"]
        time.sleep(0.3)

    # 埋め込み
    for clip in clips:
        gid = clip.get("game")
        clip["game"]      = id_to_name.get(gid, gid or "Unknown")
        clip["game_name"] = clip["game"]
        clip.pop("game_name", None)  # 重複キーを整理

    return clips


# ============================================================
#  メイン処理
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description="Twitch の特定配信者のクリップを全件取得して JSON に保存"
    )
    parser.add_argument("--channel",     required=True,  help="配信者のログイン名（例: jinwktk）")
    parser.add_argument("--output",      default="data/clips.json", help="出力先 JSON ファイルパス")
    parser.add_argument("--started_at",  default=None,   help="取得開始日時 (例: 2024-01-01 または 2024-01-01T00:00:00Z)")
    parser.add_argument("--ended_at",    default=None,   help="取得終了日時")
    parser.add_argument("--max_clips",   default=None,   type=int, help="取得件数の上限（省略時: 全件）")
    parser.add_argument("--no_game_names", action="store_true", help="ゲーム名取得をスキップ（高速化）")
    args = parser.parse_args()

    # 認証情報
    client_id     = os.getenv("TWITCH_CLIENT_ID", "").strip()
    client_secret = os.getenv("TWITCH_CLIENT_SECRET", "").strip()

    if not client_id or not client_secret:
        print(
            "❌ エラー: TWITCH_CLIENT_ID と TWITCH_CLIENT_SECRET が設定されていません。\n"
            "   .env ファイルを作成するか、環境変数に直接セットしてください。\n"
            "   Twitch Developer Console: https://dev.twitch.tv/console/apps"
        )
        sys.exit(1)

    # 日付フォーマット補完（RFC 3339 に変換）
    def to_rfc3339(s):
        if s and "T" not in s:
            return s + "T00:00:00Z"
        return s

    started_at = to_rfc3339(args.started_at)
    ended_at   = to_rfc3339(args.ended_at)

    print(f"\n🚀 クリップ取得開始")
    print(f"   対象チャンネル : {args.channel}")
    print(f"   開始日時       : {started_at or '（指定なし）'}")
    print(f"   終了日時       : {ended_at   or '（指定なし）'}")
    print(f"   取得上限       : {args.max_clips or '全件'}")
    print()

    # トークン取得
    token     = get_access_token(client_id, client_secret)
    headers   = {
        "Client-Id":    client_id,
        "Authorization": f"Bearer {token}",
    }

    # ユーザー ID 取得
    broadcaster_id, display_name = get_user_id(args.channel, headers)

    # クリップ全件取得
    print(f"\n📡 クリップを取得中…")
    raw_clips = fetch_all_clips(
        broadcaster_id = broadcaster_id,
        headers        = headers,
        started_at     = started_at,
        ended_at       = ended_at,
        max_clips      = args.max_clips,
    )

    if not raw_clips:
        print("⚠️  クリップが 0 件でした。チャンネル名や日付範囲を確認してください。")
        sys.exit(0)

    print(f"\n✅ 合計 {len(raw_clips)} 件取得完了")

    # フォーマット変換
    clips = [normalize_clip(c) for c in raw_clips]

    # ゲーム名を付与
    if not args.no_game_names:
        clips = fill_game_names(clips, headers)

    # 出力先ディレクトリを作成
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # JSON 保存
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)

    print(f"\n💾 保存完了: {output_path}  ({len(clips)} clips)")
    print(f"   次のステップ: clip-search フォルダで http.server を起動してサイトを確認してください")
    print(f"   → python -m http.server 8080")


if __name__ == "__main__":
    main()
