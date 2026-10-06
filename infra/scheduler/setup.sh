#!/usr/bin/env bash
# GCP Cloud Scheduler → Cloud Workflows → GitHub workflow_dispatch の起動経路を冪等にセットアップする。
# 何度実行しても安全（既存リソースは更新または作成スキップ）。詳細:
# docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md
#
# 認証は GitHub App のインストールトークン（1時間で失効）。App の秘密鍵は Cloud KMS に署名専用で
# 置き、GCP に PAT 等の長期の秘密情報は保存しない。
#
# 使い方（この順に実行）:
#   bash infra/scheduler/setup.sh kms       # 1. API有効化・SA・キーリング・署名鍵（インポート専用）・署名権限
#   node infra/scheduler/bootstrap-github-app.mjs   # 2. GitHub App の作成と秘密鍵の KMS インポート（一度きり）
#   GITHUB_APP_ID=<App ID> KMS_KEY_VERSION=<鍵バージョン> bash infra/scheduler/setup.sh deploy   # 3. Workflows・アラート・Schedulerジョブ
#     （どちらも非機密。2 の出力の「次の手順」にそのまま表示される。GITHUB_APP_ID は再デプロイ時は省略可で
#       デプロイ済みの値を引き継ぐ。KMS_KEY_VERSION を省略すると有効な最新の鍵バージョンを使う）
set -euo pipefail

PROJECT="ai-notebot-yh"
ACCOUNT="hy.unimail.11@gmail.com"
REGION="asia-northeast1"
SA_NAME="ai-notebot-dispatcher"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
KEYRING="github-app"
KEY="github-app-signer"
WORKFLOW="github-dispatch"
ALERT_NAME="ai-notebot: Scheduler起動失敗"
CHANNEL_NAME="ai-notebot-scheduler-email"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

g() { gcloud "$@" --project "$PROJECT" --account "$ACCOUNT"; }

# list の結果が複数行（フィルタが複数件ヒット）なら、重複作成や壊れた update を避けるため止める
at_most_one() { # $1=説明 $2=list結果
  if [ "$(printf '%s' "$2" | grep -c .)" -gt 1 ]; then
    echo "ERROR: ${1} が複数件見つかりました。手動で整理してから再実行してください:" >&2
    printf '%s\n' "$2" >&2
    exit 1
  fi
}

setup_kms() {
  g services enable cloudscheduler.googleapis.com workflows.googleapis.com workflowexecutions.googleapis.com \
    cloudkms.googleapis.com monitoring.googleapis.com logging.googleapis.com

  if [ -z "$(g iam service-accounts list --filter="email=${SA_EMAIL}" --format='value(email)')" ]; then
    g iam service-accounts create "$SA_NAME" --display-name "ai-notebot Scheduler/Workflows dispatcher"
  fi

  if [ -z "$(g kms keyrings list --location "$REGION" --filter="name~/${KEYRING}\$" --format='value(name)')" ]; then
    g kms keyrings create "$KEYRING" --location "$REGION"
  fi

  # 署名専用・インポート専用の鍵（GitHub が生成した秘密鍵を bootstrap-github-app.mjs でインポートする）。
  # 秘密鍵は KMS の外に出せず、署名操作しかできない。
  if [ -z "$(g kms keys list --keyring "$KEYRING" --location "$REGION" --filter="name~/${KEY}\$" --format='value(name)')" ]; then
    g kms keys create "$KEY" --keyring "$KEYRING" --location "$REGION" \
      --purpose asymmetric-signing --default-algorithm rsa-sign-pkcs1-2048-sha256 \
      --protection-level software --skip-initial-version-creation --import-only
  fi

  # SA にはこの鍵に対する署名権限（roles/cloudkms.signer）のみ付与する
  g kms keys add-iam-policy-binding "$KEY" --keyring "$KEYRING" --location "$REGION" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/cloudkms.signer >/dev/null
  # Scheduler が Workflows の executions API を呼ぶための権限
  g projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/workflows.invoker --condition=None >/dev/null
  # Workflows 実行時のログ書き込み
  g projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/logging.logWriter --condition=None >/dev/null

  echo "OK: 署名鍵 '${KEY}'（キーリング '${KEYRING}'）まで作成済み。次は node infra/scheduler/bootstrap-github-app.mjs を実行してください。"
}

upsert_job() { # $1=ジョブ名 $2=cron $3=Workflows引数(JSON)
  local name="$1" schedule="$2" arg="$3"
  local uri="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/workflows/${WORKFLOW}/executions"
  # Workflows executions API の argument は「JSON文字列」を値に持つ
  local body
  body="$(ARG="$arg" python3 -c 'import json,os; print(json.dumps({"argument": os.environ["ARG"]}))')"
  local common=(--location "$REGION" --schedule "$schedule" --time-zone "Asia/Tokyo" --uri "$uri"
    --http-method POST --message-body "$body"
    --oauth-service-account-email "$SA_EMAIL" --attempt-deadline 60s --max-retry-attempts 3 --min-backoff 30s)
  # ヘッダーのフラグは create が --headers、update が --update-headers と異なる
  # （update に --headers は無く、共用すると2回目以降の実行が失敗する。PRレビューで指摘）。
  if g scheduler jobs describe "$name" --location "$REGION" >/dev/null 2>&1; then
    g scheduler jobs update http "$name" "${common[@]}" --update-headers "Content-Type=application/json"
  else
    g scheduler jobs create http "$name" "${common[@]}" --headers "Content-Type=application/json"
  fi
}

setup_alert() {
  local channel
  channel="$(g beta monitoring channels list --filter="displayName=\"${CHANNEL_NAME}\"" --format='value(name)')"
  at_most_one "通知チャネル '${CHANNEL_NAME}'" "$channel"
  if [ -z "$channel" ]; then
    channel="$(g beta monitoring channels create --display-name "$CHANNEL_NAME" --type email \
      --channel-labels "email_address=${ACCOUNT}" --format='value(name)')"
  fi

  local policy_file
  policy_file="$(mktemp)"
  # RETURN トラップは関数を抜けた後も呼び出し元の return で再発火し、スコープ外の変数を
  # 参照して set -u で落ちる（codex reviewで指摘）ため使わず、末尾で明示的に削除する。
  cat >"$policy_file" <<EOF
{
  "displayName": "${ALERT_NAME}",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Workflows または Scheduler の ERROR ログ",
    "conditionMatchedLog": {
      "filter": "(resource.type=\"workflows.googleapis.com/Workflow\" AND resource.labels.workflow_id=\"${WORKFLOW}\" AND severity>=ERROR) OR (resource.type=\"cloud_scheduler_job\" AND severity>=ERROR)"
    }
  }],
  "alertStrategy": {"notificationRateLimit": {"period": "3600s"}},
  "notificationChannels": ["${channel}"]
}
EOF
  local existing
  existing="$(g monitoring policies list --filter="displayName=\"${ALERT_NAME}\"" --format='value(name)')"
  at_most_one "アラートポリシー '${ALERT_NAME}'" "$existing"
  local rc=0
  if [ -n "$existing" ]; then
    g monitoring policies update "$existing" --policy-from-file "$policy_file" || rc=$?
  else
    g monitoring policies create --policy-from-file "$policy_file" || rc=$?
  fi
  rm -f "$policy_file"
  return "$rc"
}

setup_deploy() {
  # 署名に使う鍵バージョン。KMS_KEY_VERSION（bootstrap-github-app.mjs の出力）で明示するのが確実。
  # 未指定なら有効なものの最新（作成時刻順。名前の文字列順だと versions/9 が versions/10 より後ろになる）。
  # 未指定時は、App と対応しない鍵（使い捨て・検証失敗）を拾いうるため、ローテーション後は明示を推奨する。
  local key_version="${KMS_KEY_VERSION:-}"
  local key_prefix="projects/${PROJECT}/locations/${REGION}/keyRings/${KEYRING}/cryptoKeys/${KEY}/cryptoKeyVersions/"
  if [ -n "$key_version" ]; then
    if ! [[ "$key_version" =~ ^${key_prefix}[0-9]+$ ]]; then
      echo "ERROR: KMS_KEY_VERSION が不正です（期待: ${key_prefix}<番号>）: ${key_version}" >&2
      exit 1
    fi
    if [ "$(g kms keys versions describe "${key_version##*/}" --key "$KEY" --keyring "$KEYRING" --location "$REGION" --format='value(state)' 2>/dev/null || true)" != "ENABLED" ]; then
      echo "ERROR: 指定の鍵バージョンが存在しないか ENABLED ではありません: ${key_version}" >&2
      exit 1
    fi
  else
    key_version="$(g kms keys versions list --key "$KEY" --keyring "$KEYRING" --location "$REGION" \
      --filter="state=ENABLED" --sort-by=~createTime --limit 1 --format='value(name)')"
  fi
  if [ -z "$key_version" ]; then
    echo "ERROR: 鍵 '${KEY}' に有効なバージョンがありません。先に node infra/scheduler/bootstrap-github-app.mjs で秘密鍵をインポートしてください。" >&2
    exit 1
  fi

  # App ID（非機密の整数。JWT の iss）。未指定ならデプロイ済み Workflows の値を引き継ぐ。
  local app_id="${GITHUB_APP_ID:-}"
  if [ -z "$app_id" ]; then
    app_id="$(g workflows describe "$WORKFLOW" --location "$REGION" --format='value(userEnvVars.GITHUB_APP_ID)' 2>/dev/null || true)"
  fi
  if ! [[ "$app_id" =~ ^[0-9]+$ ]]; then
    echo "ERROR: GITHUB_APP_ID（整数）が未指定または不正で、デプロイ済みの値もありません。bootstrap-github-app.mjs の出力の App ID を指定してください。" >&2
    exit 1
  fi

  g workflows deploy "$WORKFLOW" --location "$REGION" --source "${HERE}/github-dispatch.workflows.yaml" \
    --service-account "$SA_EMAIL" --call-log-level log-errors-only \
    --set-env-vars "GITHUB_APP_ID=${app_id},KMS_KEY_VERSION=${key_version}" \
    --description "GitHub Actions workflow_dispatch を起動する（Cloud Scheduler用）"

  # アラートを先に作る: ジョブ作成後にアラート作成が失敗すると、無監視のままジョブだけ稼働してしまうため
  setup_alert
  upsert_job "daily-digest-dispatch" "0 6 * * *" '{"workflow":"daily.yml","inputs":{"skip_if_exists":"true"}}'
  upsert_job "weekly-digest-dispatch" "20 8 * * 0" '{"workflow":"weekly.yml","inputs":{"skip_if_exists":"true"}}'
  echo "OK: Workflows・アラート・Schedulerジョブ2本を設定しました。"
}

case "${1:-}" in
  kms) setup_kms ;;
  deploy) setup_deploy ;;
  *) echo "usage: $0 {kms|deploy}" >&2; exit 2 ;;
esac
