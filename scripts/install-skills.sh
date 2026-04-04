#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# install-skills.sh — Install/update CodeGraph AI skills for Claude and Copilot
#
# Copies skills from this repo's skills/ folder to:
#   - Claude:  ~/.claude/skills/codegraph-*
#   - Copilot: ~/.github/copilot-instructions.d/codegraph-*
#
# Usage:
#   ./scripts/install-skills.sh           # Install for both
#   ./scripts/install-skills.sh --claude  # Claude only
#   ./scripts/install-skills.sh --copilot # Copilot only
#   ./scripts/install-skills.sh --check   # Check install status
# -----------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"

CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
COPILOT_INSTRUCTIONS_DIR="$HOME/.github/copilot-instructions.d"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SKILL_DIRS=(
  "codegraph-scenario-discovery"
  "codegraph-scenario-tracing"
  "codegraph-code-walk"
  "codegraph-correction-interpreter"
)

# ---- Helpers ----------------------------------------------------------------

print_header() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  CodeGraph AI Skills Installer                   ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_skill() {
  local name="$1"
  local status="$2"
  local target="$3"
  if [ "$status" = "installed" ]; then
    echo -e "  ${GREEN}✔${NC} ${BOLD}${name}${NC} ${DIM}→ ${target}${NC}"
  elif [ "$status" = "updated" ]; then
    echo -e "  ${YELLOW}↻${NC} ${BOLD}${name}${NC} ${DIM}→ ${target}${NC}"
  elif [ "$status" = "missing" ]; then
    echo -e "  ${RED}✖${NC} ${BOLD}${name}${NC} ${DIM}(not installed)${NC}"
  elif [ "$status" = "current" ]; then
    echo -e "  ${GREEN}✔${NC} ${BOLD}${name}${NC} ${DIM}(up to date)${NC}"
  fi
}

# ---- Install functions ------------------------------------------------------

install_claude_skills() {
  echo -e "${BOLD}Installing Claude skills...${NC}"
  mkdir -p "$CLAUDE_SKILLS_DIR"

  local count=0
  for skill in "${SKILL_DIRS[@]}"; do
    local src="$SKILLS_SRC/$skill"
    local dst="$CLAUDE_SKILLS_DIR/$skill"

    if [ ! -d "$src" ]; then
      echo -e "  ${RED}✖${NC} Source not found: $src"
      continue
    fi

    mkdir -p "$dst"
    if [ -f "$dst/SKILL.md" ] && diff -q "$src/SKILL.md" "$dst/SKILL.md" >/dev/null 2>&1; then
      print_skill "$skill" "current" "$dst"
    else
      cp "$src/SKILL.md" "$dst/SKILL.md"
      if [ -f "$dst/SKILL.md" ]; then
        print_skill "$skill" "updated" "$dst"
      else
        print_skill "$skill" "installed" "$dst"
      fi
      count=$((count + 1))
    fi
  done

  if [ $count -eq 0 ]; then
    echo -e "  ${DIM}All Claude skills are up to date.${NC}"
  else
    echo -e "  ${GREEN}${count} skill(s) installed/updated.${NC}"
  fi
  echo ""
}

install_copilot_skills() {
  echo -e "${BOLD}Installing Copilot instructions...${NC}"
  mkdir -p "$COPILOT_INSTRUCTIONS_DIR"

  local count=0
  for skill in "${SKILL_DIRS[@]}"; do
    local src="$SKILLS_SRC/$skill/SKILL.md"
    local dst="$COPILOT_INSTRUCTIONS_DIR/${skill}.md"

    if [ ! -f "$src" ]; then
      echo -e "  ${RED}✖${NC} Source not found: $src"
      continue
    fi

    if [ -f "$dst" ] && diff -q "$src" "$dst" >/dev/null 2>&1; then
      print_skill "$skill" "current" "$dst"
    else
      cp "$src" "$dst"
      if [ -f "$dst" ]; then
        print_skill "$skill" "updated" "$dst"
      else
        print_skill "$skill" "installed" "$dst"
      fi
      count=$((count + 1))
    fi
  done

  if [ $count -eq 0 ]; then
    echo -e "  ${DIM}All Copilot instructions are up to date.${NC}"
  else
    echo -e "  ${GREEN}${count} instruction(s) installed/updated.${NC}"
  fi
  echo ""
}

check_status() {
  echo -e "${BOLD}Claude skills (~/.claude/skills/):${NC}"
  for skill in "${SKILL_DIRS[@]}"; do
    local dst="$CLAUDE_SKILLS_DIR/$skill/SKILL.md"
    local src="$SKILLS_SRC/$skill/SKILL.md"
    if [ -f "$dst" ]; then
      if diff -q "$src" "$dst" >/dev/null 2>&1; then
        print_skill "$skill" "current" ""
      else
        echo -e "  ${YELLOW}↻${NC} ${BOLD}${skill}${NC} ${DIM}(outdated — run install to update)${NC}"
      fi
    else
      print_skill "$skill" "missing" ""
    fi
  done
  echo ""

  echo -e "${BOLD}Copilot instructions (~/.github/copilot-instructions.d/):${NC}"
  for skill in "${SKILL_DIRS[@]}"; do
    local dst="$COPILOT_INSTRUCTIONS_DIR/${skill}.md"
    local src="$SKILLS_SRC/$skill/SKILL.md"
    if [ -f "$dst" ]; then
      if diff -q "$src" "$dst" >/dev/null 2>&1; then
        print_skill "$skill" "current" ""
      else
        echo -e "  ${YELLOW}↻${NC} ${BOLD}${skill}${NC} ${DIM}(outdated — run install to update)${NC}"
      fi
    else
      print_skill "$skill" "missing" ""
    fi
  done
  echo ""
}

# ---- Main -------------------------------------------------------------------

print_header

case "${1:-all}" in
  --claude)
    install_claude_skills
    ;;
  --copilot)
    install_copilot_skills
    ;;
  --check)
    check_status
    ;;
  --help|-h)
    echo "Usage: $0 [--claude|--copilot|--check|--help]"
    echo ""
    echo "  (default)   Install for both Claude and Copilot"
    echo "  --claude    Install Claude skills only"
    echo "  --copilot   Install Copilot instructions only"
    echo "  --check     Check installation status"
    echo "  --help      Show this help"
    echo ""
    ;;
  all|"")
    install_claude_skills
    install_copilot_skills
    echo -e "${GREEN}${BOLD}Done!${NC} Skills are now available in any repo."
    echo -e "${DIM}  Claude: Start a session and the skills will be auto-loaded."
    echo -e "  Copilot: Instructions are picked up from ~/.github/copilot-instructions.d/${NC}"
    echo ""
    ;;
  *)
    echo -e "${RED}Unknown option: $1${NC}"
    echo "Run $0 --help for usage."
    exit 1
    ;;
esac
