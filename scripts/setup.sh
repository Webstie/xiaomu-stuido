#!/usr/bin/env bash
# =============================================================================
# scripts/setup.sh — Idempotent Azure resource provisioning for Xiaomu Studio
#
# Usage:  bash scripts/setup.sh
# Needs:  az CLI (brew install azure-cli), logged in via `az login`
# No deps: no python3, no jq required.
#
# What it does (check-then-create everywhere):
#   1. Verify az installed + user is logged in
#   2. Warn if caller lacks Owner role on the subscription
#   3. Ensure rg-xiaomu-studio exists in southeastasia
#   4. Ensure xiaomu-foundry (AIServices, S0) exists
#   5. Ensure gpt-5-chat deployment exists on it (GlobalStandard, capacity 50)
#   6. Ensure xiaomu-speech (SpeechServices, S0) exists
#   7. Extract endpoint + keys; write/update .env (never prints keys to stdout)
#   8. Print created vs already-existed summary
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RESOURCE_GROUP="rg-xiaomu-studio"
LOCATION="southeastasia"

FOUNDRY_ACCOUNT="xiaomu-foundry"
FOUNDRY_SKU="S0"
FOUNDRY_DEPLOYMENT="gpt-5-chat"
FOUNDRY_MODEL_NAME="gpt-5"
# NOTE: If Azure requires an explicit version string, update FOUNDRY_MODEL_VERSION.
# Run `az cognitiveservices model list -l southeastasia --query "[?model.name=='gpt-5']"
# -o table` to see available versions if this deployment step fails.
FOUNDRY_MODEL_VERSION="2025-02-27"
FOUNDRY_API_VERSION="2025-04-01-preview"
FOUNDRY_DEFAULT_VOICE="zh-CN-XiaoxiaoMultilingualNeural"

SPEECH_ACCOUNT="xiaomu-speech"
SPEECH_SKU="S0"

# ── Colours ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; R='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${G}✓${NC}  $*"; }
warn() { echo -e "${Y}⚠${NC}   $*"; }
info() { echo -e "${B}→${NC}  $*"; }
err()  { echo -e "${R}✗${NC}  $*" >&2; }
sep()  { echo -e "${B}────────────────────────────────────────${NC}"; }

CREATED=()
EXISTED=()

# ── az wrapper ────────────────────────────────────────────────────────────────
# Runs the given az command; on failure prints the full command + az error then exits.
az_run() {
  local out
  local cmd_str="az ${*:2}"   # strip the leading "az" arg for display
  if ! out=$("$@" 2>&1); then
    err "az command failed:"
    err "  ${cmd_str}"
    err "  ${out}"
    exit 1
  fi
  printf '%s' "$out"
}

# ── Repo root + file paths ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

# ── .env upsert helper (never echoes values) ──────────────────────────────────
# Usage: upsert_env KEY VALUE
upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    # macOS BSD sed: -i requires an extension argument (empty string = in-place)
    sed -i '' "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    echo "${key}=${value}" >> "${ENV_FILE}"
  fi
}

# =============================================================================
echo ""
echo -e "${B}╔══════════════════════════════════════════╗${NC}"
echo -e "${B}║   Xiaomu Studio — Azure Setup            ║${NC}"
echo -e "${B}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: az installed + logged in ─────────────────────────────────────────
sep
info "Step 1 — Checking az CLI + login"

if ! command -v az &>/dev/null; then
  err "az CLI not found. Install with: brew install azure-cli"
  exit 1
fi
ok "az CLI found ($(az version --query '"azure-cli"' -o tsv))"

SUBSCRIPTION_ID=$(az_run az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az_run az account show --query name -o tsv)
ACCOUNT_USER=$(az_run az account show --query user.name -o tsv)
ok "Logged in as: ${ACCOUNT_USER}"
ok "Subscription: ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

# ── Step 2: Owner role warning ────────────────────────────────────────────────
sep
info "Step 2 — Checking Owner role on subscription"

OWNER_COUNT=$(az_run az role assignment list \
  --role Owner \
  --scope "/subscriptions/${SUBSCRIPTION_ID}" \
  --query "length([?principalName=='${ACCOUNT_USER}'])" \
  -o tsv)

if [[ "${OWNER_COUNT}" -ge 1 ]]; then
  ok "Owner role confirmed on subscription"
else
  warn "Owner role NOT found for ${ACCOUNT_USER} on this subscription."
  warn "Resource creation may fail without sufficient permissions."
  warn "Continuing — some steps may need manual intervention."
fi

# ── Step 3: Resource group ────────────────────────────────────────────────────
sep
info "Step 3 — Resource group: ${RESOURCE_GROUP} (${LOCATION})"

RG_EXISTS=$(az_run az group show \
  --name "${RESOURCE_GROUP}" \
  --query name \
  -o tsv 2>/dev/null || true)

if [[ "${RG_EXISTS}" == "${RESOURCE_GROUP}" ]]; then
  ok "Resource group already exists"
  EXISTED+=("resource-group/${RESOURCE_GROUP}")
else
  info "Creating resource group..."
  az_run az group create \
    --name "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    -o none
  ok "Resource group created"
  CREATED+=("resource-group/${RESOURCE_GROUP}")
fi

# ── Step 4: Foundry account (AIServices) ─────────────────────────────────────
sep
info "Step 4 — Foundry account: ${FOUNDRY_ACCOUNT} (AIServices ${FOUNDRY_SKU})"

FOUNDRY_EXISTS=$(az cognitiveservices account show \
  --name "${FOUNDRY_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query name \
  -o tsv 2>/dev/null || true)

if [[ "${FOUNDRY_EXISTS}" == "${FOUNDRY_ACCOUNT}" ]]; then
  ok "Foundry account already exists"
  EXISTED+=("foundry/${FOUNDRY_ACCOUNT}")
else
  info "Creating Foundry account..."
  az_run az cognitiveservices account create \
    --name "${FOUNDRY_ACCOUNT}" \
    --resource-group "${RESOURCE_GROUP}" \
    --kind AIServices \
    --sku "${FOUNDRY_SKU}" \
    --location "${LOCATION}" \
    --yes \
    -o none
  ok "Foundry account created"
  CREATED+=("foundry/${FOUNDRY_ACCOUNT}")
fi

# ── Step 5: gpt-5-chat deployment ────────────────────────────────────────────
sep
info "Step 5 — Deployment: ${FOUNDRY_DEPLOYMENT} (${FOUNDRY_MODEL_NAME} GlobalStandard cap=50)"

DEPLOY_EXISTS=$(az cognitiveservices account deployment show \
  --name "${FOUNDRY_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --deployment-name "${FOUNDRY_DEPLOYMENT}" \
  --query name \
  -o tsv 2>/dev/null || true)

if [[ "${DEPLOY_EXISTS}" == "${FOUNDRY_DEPLOYMENT}" ]]; then
  ok "Deployment already exists"
  EXISTED+=("deployment/${FOUNDRY_DEPLOYMENT}")
else
  info "Creating deployment (this may take 1–2 minutes)..."
  info "Model: ${FOUNDRY_MODEL_NAME} v${FOUNDRY_MODEL_VERSION}, GlobalStandard, capacity 50"
  info "If this fails with 'model not found', run:"
  info "  az cognitiveservices model list -l ${LOCATION} --query \"[?model.name=='${FOUNDRY_MODEL_NAME}']\" -o table"
  az_run az cognitiveservices account deployment create \
    --name "${FOUNDRY_ACCOUNT}" \
    --resource-group "${RESOURCE_GROUP}" \
    --deployment-name "${FOUNDRY_DEPLOYMENT}" \
    --model-format OpenAI \
    --model-name "${FOUNDRY_MODEL_NAME}" \
    --model-version "${FOUNDRY_MODEL_VERSION}" \
    --sku-name GlobalStandard \
    --sku-capacity 50 \
    -o none
  ok "Deployment created"
  CREATED+=("deployment/${FOUNDRY_DEPLOYMENT}")
fi

# ── Step 6: Speech account ────────────────────────────────────────────────────
sep
info "Step 6 — Speech account: ${SPEECH_ACCOUNT} (SpeechServices ${SPEECH_SKU})"

SPEECH_EXISTS=$(az cognitiveservices account show \
  --name "${SPEECH_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query name \
  -o tsv 2>/dev/null || true)

if [[ "${SPEECH_EXISTS}" == "${SPEECH_ACCOUNT}" ]]; then
  ok "Speech account already exists"
  EXISTED+=("speech/${SPEECH_ACCOUNT}")
else
  info "Creating Speech account..."
  az_run az cognitiveservices account create \
    --name "${SPEECH_ACCOUNT}" \
    --resource-group "${RESOURCE_GROUP}" \
    --kind SpeechServices \
    --sku "${SPEECH_SKU}" \
    --location "${LOCATION}" \
    --yes \
    -o none
  ok "Speech account created"
  CREATED+=("speech/${SPEECH_ACCOUNT}")
fi

# ── Step 7: Extract keys + write .env ────────────────────────────────────────
sep
info "Step 7 — Extracting keys and writing .env"

# Foundry
FOUNDRY_ENDPOINT=$(az_run az cognitiveservices account show \
  --name "${FOUNDRY_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "properties.endpoint" \
  -o tsv)
# Keys are extracted but never printed to stdout
FOUNDRY_KEY=$(az_run az cognitiveservices account keys list \
  --name "${FOUNDRY_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query key1 \
  -o tsv)

# Speech
SPEECH_KEY=$(az_run az cognitiveservices account keys list \
  --name "${SPEECH_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query key1 \
  -o tsv)

# Seed from .env.example if .env does not exist
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    info "Seeded .env from .env.example"
  else
    touch "${ENV_FILE}"
    info "Created empty .env"
  fi
fi
chmod 600 "${ENV_FILE}"

# Upsert Azure vars (values never echo'd to terminal)
upsert_env "AZURE_FOUNDRY_ENDPOINT" "${FOUNDRY_ENDPOINT}"
upsert_env "AZURE_FOUNDRY_KEY"      "${FOUNDRY_KEY}"
upsert_env "AZURE_FOUNDRY_DEPLOYMENT" "${FOUNDRY_DEPLOYMENT}"
upsert_env "AZURE_FOUNDRY_API_VERSION" "${FOUNDRY_API_VERSION}"
upsert_env "AZURE_SPEECH_KEY"        "${SPEECH_KEY}"
upsert_env "AZURE_SPEECH_REGION"     "${LOCATION}"
upsert_env "AZURE_SPEECH_DEFAULT_VOICE" "${FOUNDRY_DEFAULT_VOICE}"

ok ".env written (keys NOT shown in log)"
ok "Foundry endpoint: ${FOUNDRY_ENDPOINT}"

# ── Step 8: Summary ───────────────────────────────────────────────────────────
sep
echo ""
echo -e "${G}Setup complete.${NC}"
echo ""

if [[ ${#CREATED[@]} -gt 0 ]]; then
  echo -e "${G}Created (new):${NC}"
  for item in "${CREATED[@]}"; do
    echo "  + ${item}"
  done
fi

if [[ ${#EXISTED[@]} -gt 0 ]]; then
  echo -e "${B}Already existed (no changes):${NC}"
  for item in "${EXISTED[@]}"; do
    echo "  · ${item}"
  done
fi

echo ""
echo "Next step: run the viseme spike to verify zh-CN TTS:"
echo "  pnpm spike:viseme"
echo ""
