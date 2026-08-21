#!/usr/bin/env bash
# Rebuilds ui/vendor/markdown-it.mjs.
#
# The extension ships without node_modules and loads native ES modules off disk,
# so the Markdown renderer is committed as a single self-contained bundle. This
# script is the only supported way to produce it: pin, bundle, copy. Do not edit
# the generated file by hand.
#
# Versions are pinned to what Azure DevOps itself ships, so the canvas renders a
# description the same way Azure DevOps will. See ui/vendor/README.md.
set -euo pipefail

MARKDOWN_IT_VERSION="14.2.0"
TASK_LISTS_VERSION="2.0.1"
EMOJI_VERSION="3.1.0"
ESBUILD_VERSION="0.25.0"

extension_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${extension_dir}/ui/vendor/markdown-it.mjs"

build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

cd "${build_dir}"
npm init -y >/dev/null
npm install --no-audit --no-fund \
    "markdown-it@${MARKDOWN_IT_VERSION}" \
    "markdown-it-task-lists@${TASK_LISTS_VERSION}" \
    "markdown-it-emoji@${EMOJI_VERSION}" >/dev/null

cat > entry.mjs <<'ENTRY'
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { full as emoji } from "markdown-it-emoji";
export { MarkdownIt, taskLists, emoji };
ENTRY

npx --yes "esbuild@${ESBUILD_VERSION}" entry.mjs \
    --bundle --format=esm --minify --platform=browser \
    --outfile=bundle.mjs >/dev/null

mkdir -p "$(dirname "${output}")"
cp bundle.mjs "${output}"

printf 'wrote %s (%s KB)\n' "${output}" "$(( $(wc -c < "${output}") / 1024 ))"
