#!/usr/bin/env bash
# ============================================================================
# Aglen — Setup Script
# Creates venv, installs deps, downloads PlantVillage dataset from Kaggle.
# ============================================================================
set -euo pipefail

VENV_DIR="venv"
DATA_DIR="data/plantvillage"
KAGGLE_DATASET="vipoooool/new-plant-diseases-dataset"

# ── Colors for output ───────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Step 1: Create Python 3.11 virtual environment ─────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Aglen — Environment Setup"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ -d "$VENV_DIR" ]; then
    warn "Virtual environment '$VENV_DIR' already exists. Skipping creation."
else
    info "Creating Python 3.11 virtual environment..."
    python3.11 -m venv "$VENV_DIR" || error "Failed to create venv. Is Python 3.11 installed?"
    info "Virtual environment created at ./$VENV_DIR"
fi

# ── Activate venv ───────────────────────────────────────────────────────────
info "Activating virtual environment..."
source "$VENV_DIR/bin/activate" || error "Failed to activate virtual environment."
info "Using Python: $(python --version) at $(which python)"

# ── Step 2: Install requirements ────────────────────────────────────────────
info "Upgrading pip..."
pip install --upgrade pip --quiet || error "Failed to upgrade pip."

info "Installing dependencies from requirements.txt..."
pip install -r requirements.txt --quiet || error "Failed to install requirements."
info "All dependencies installed successfully."

# ── Step 3: Download PlantVillage dataset from Kaggle ───────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Downloading PlantVillage Dataset"
echo "────────────────────────────────────────────────────────────"
echo ""

# Check kaggle CLI is available
if ! command -v kaggle &> /dev/null; then
    warn "Kaggle CLI not found. Installing..."
    pip install kaggle --quiet || error "Failed to install kaggle CLI."
fi

# Verify Kaggle credentials
if [ ! -f "$HOME/.kaggle/kaggle.json" ]; then
    error "Kaggle credentials not found at ~/.kaggle/kaggle.json. \
Please create a Kaggle API token: https://www.kaggle.com/settings → 'Create New Token'"
fi

# Create data directory
mkdir -p "$DATA_DIR"

# Download and extract dataset
TEMP_DIR="data/_kaggle_tmp"
mkdir -p "$TEMP_DIR"

info "Downloading dataset: $KAGGLE_DATASET ..."
kaggle datasets download -d "$KAGGLE_DATASET" -p "$TEMP_DIR" --unzip \
    || error "Failed to download dataset from Kaggle."

# The dataset extracts to: New Plant Diseases Dataset(Augmented)/New Plant Diseases Dataset(Augmented)/
# We need to move the train/valid folders into data/plantvillage/
EXTRACTED_ROOT="$TEMP_DIR/New Plant Diseases Dataset(Augmented)/New Plant Diseases Dataset(Augmented)"

if [ -d "$EXTRACTED_ROOT" ]; then
    info "Moving dataset to $DATA_DIR ..."

    # Move train and valid directories
    if [ -d "$EXTRACTED_ROOT/train" ]; then
        cp -r "$EXTRACTED_ROOT/train" "$DATA_DIR/train"
        info "Copied training data."
    fi

    if [ -d "$EXTRACTED_ROOT/valid" ]; then
        cp -r "$EXTRACTED_ROOT/valid" "$DATA_DIR/valid"
        info "Copied validation data."
    fi
else
    # Fallback: check if structure is flat
    warn "Expected nested structure not found. Searching for image directories..."
    FOUND_DIR=$(find "$TEMP_DIR" -type d -name "train" | head -1)
    if [ -n "$FOUND_DIR" ]; then
        PARENT_DIR=$(dirname "$FOUND_DIR")
        cp -r "$PARENT_DIR/train" "$DATA_DIR/train" 2>/dev/null || true
        cp -r "$PARENT_DIR/valid" "$DATA_DIR/valid" 2>/dev/null || true
        info "Copied dataset from discovered path."
    else
        error "Could not locate dataset directories after extraction."
    fi
fi

# Clean up temp files
info "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

# ── Step 4: Print confirmation ──────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Dataset Summary"
echo "────────────────────────────────────────────────────────────"
echo ""

if [ -d "$DATA_DIR/train" ]; then
    TRAIN_CLASSES=$(find "$DATA_DIR/train" -mindepth 1 -maxdepth 1 -type d | wc -l)
    TRAIN_IMAGES=$(find "$DATA_DIR/train" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)
    info "Training:   $TRAIN_CLASSES classes, $TRAIN_IMAGES images"
else
    warn "No training directory found."
fi

if [ -d "$DATA_DIR/valid" ]; then
    VAL_CLASSES=$(find "$DATA_DIR/valid" -mindepth 1 -maxdepth 1 -type d | wc -l)
    VAL_IMAGES=$(find "$DATA_DIR/valid" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)
    info "Validation: $VAL_CLASSES classes, $VAL_IMAGES images"
else
    warn "No validation directory found."
fi

TOTAL_IMAGES=$(find "$DATA_DIR" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)
info "Total images: $TOTAL_IMAGES"

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Aglen setup complete!${NC}"
echo ""
echo "  Activate the environment with:"
echo "    source venv/bin/activate"
echo ""
echo "  Next steps:"
echo "    1. Copy .env.example → .env and fill in your keys"
echo "    2. Run training: python -m src.train"
echo "════════════════════════════════════════════════════════════"
echo ""
