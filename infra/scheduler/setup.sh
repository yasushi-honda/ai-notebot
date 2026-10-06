#!/usr/bin/env bash
# GCP Cloud Scheduler → Cloud Workflows → GitHub workflow_dispatch の起動経路を冪等にセットアップする。
# 何度実行しても安全（既存リソースは更新または作成スキップ）。詳細:
# docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md
#
# 使い方:
#   bash infra/scheduler/setup.sh secret    # 手順3: API有効化・SA・シークレットの器まで（PAT投入前に実行）
#   bash infra/scheduler/setup.sh deploy    # 手順5: Workflows デプロイ・Schedulerジョブ・アラート（PAT投入後に実行）
#
# PAT（細粒度、ai-notebot の Actions:write のみ）の投入は、会話や履歴に出さないため本人のターミナルで:
#   read -s T && printf %s "$T" | gcloud secrets versions add github-dispatch-token \
#     --data-file=- --project ai-notebot-yh --account hy.unimail.11@gmail.com
set -euo pipefail

PROJECT="ai-notebot-yh"
ACCOUNT="hy.unimail.11@gmail.com"
REGION="asia-northeast1"
SA_NAME="ai-notebot-dispatcher"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
SECRET="github-dispatch-token"
WORKFLOW="github-dispatch"
ALERT_NAME="ai-notebot: Scheduler起動失敗"
CHANNEL_NAME="ai-notebot-scheduler-email"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

g() { gcloud "$@" --project "$PROJECT" --account "$ACCOUNT"; }

setup_secret() {
  g services enable cloudscheduler.googleapis.com workflows.googleapis.com workflowexecutions.googleapis.com \
    secretmanager.googleapis.com monitoring.googleapis.com logging.googleapis.com

  if [ -z "$(g iam service-accounts list --filter="email=${SA_EMAIL}" --format='value(email)')" ]; then
    g iam service-accounts create "$SA_NAME" --display-name "ai-notebot Scheduler/Workflows dispatcher"
  fi

  if [ -z "$(g secrets list --filter="name~/${SECRET}\$" --format='value(name)')" ]; then
    g secrets create "$SECRET" --replication-policy=user-managed --locations="$REGION"
  fi

  # シークレット単位で参照のみ許可（プロジェクト全体には付与しない）
  g secrets add-iam-policy-binding "$SECRET" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor >/dev/null
  # Scheduler が Workflows の executions API を呼ぶための権限
  g projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/workflows.invoker --condition=None >/dev/null
  # Workflows 実行時のログ書き込み
  g projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/logging.logWriter --condition=None >/dev/null

  echo "OK: シークレット '${SECRET}' の器まで作成済み。PAT の投入は本人のターミナルで行ってください（ファイル冒頭参照）。"
}

upsert_job() { # $1=ジョブ名 $2=cron $3=Workflows引数(JSON)
  local name="$1" schedule="$2" arg="$3"
  local uri="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/workflows/${WORKFLOW}/executions"
  # Workflows executions API の argument は「JSON文字列」を値に持つ
  local body
  body="$(ARG="$arg" python3 -c 'import json,os; print(json.dumps({"argument": os.environ["ARG"]}))')"
  local common=(--location "$REGION" --schedule "$schedule" --time-zone "Asia/Tokyo" --uri "$uri"
    --http-method POST --message-body "$body" --headers "Content-Type=application/json"
    --oauth-service-account-email "$SA_EMAIL" --attempt-deadline 60s --max-retry-attempts 3 --min-backoff 30s)
  if g scheduler jobs describe "$name" --location "$REGION" >/dev/null 2>&1; then
    g scheduler jobs update http "$name" "${common[@]}"
  else
    g scheduler jobs create http "$name" "${common[@]}"
  fi
}

setup_alert() {
  local channel
  channel="$(g beta monitoring channels list --filter="displayName=\"${CHANNEL_NAME}\"" --format='value(name)')"
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
  # PAT が未投入のままデプロイ・ジョブ作成すると初回実行が失敗するため先に検査する
  if [ -z "$(g secrets versions list "$SECRET" --filter="state=ENABLED" --format='value(name)' --limit 1)" ]; then
    echo "ERROR: シークレット '${SECRET}' に有効なバージョンがありません。PAT を投入してから再実行してください。" >&2
    exit 1
  fi

  g workflows deploy "$WORKFLOW" --location "$REGION" --source "${HERE}/github-dispatch.workflows.yaml" \
    --service-account "$SA_EMAIL" --call-log-level log-errors-only \
    --description "GitHub Actions workflow_dispatch を起動する（Cloud Scheduler用）"

  upsert_job "daily-digest-dispatch" "0 6 * * *" '{"workflow":"daily.yml","inputs":{"skip_if_exists":"true"}}'
  upsert_job "weekly-digest-dispatch" "20 8 * * 0" '{"workflow":"weekly.yml","inputs":{"skip_if_exists":"true"}}'
  setup_alert
  echo "OK: Workflows・Schedulerジョブ2本・アラートを設定しました。"
}

case "${1:-}" in
  secret) setup_secret ;;
  deploy) setup_deploy ;;
  *) echo "usage: $0 {secret|deploy}" >&2; exit 2 ;;
esac
