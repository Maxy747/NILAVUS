#!/usr/bin/env bash
# Publish the same NILAVUS build to the two mirrors. GitHub Pages deploys itself
# from main (.github/workflows/pages.yml); run this after pushing to main so the
# Cloudflare Worker and Dosimeter serve the identical files.
#
#   scripts/deploy-mirrors.sh            # both mirrors
#   scripts/deploy-mirrors.sh dosimeter  # just one
#
# Needs: SSH key access to Dosimeter, and `npx wrangler login` once for Cloudflare.
set -euo pipefail

DOSIMETER="${DOSIMETER:-dosimeter@192.168.1.72}"
SITE_DIR=/opt/nilavu-dashboard-local
TARGETS="${*:-dosimeter cloudflare}"

cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
  echo "Warning: working tree differs from origin/main, so the mirrors won't match GitHub Pages." >&2
fi

npm ci
npm run build
bundle=$(ls dist/assets | grep -E '^index-.*\.js$')
echo "Built $bundle"

for target in $TARGETS; do
  case "$target" in
    dosimeter)
      # Upload to a temp dir, then sync into place, so a dropped connection never leaves a half-copied site.
      tar -C dist -czf - . | ssh "$DOSIMETER" "set -e; tmp=\$(mktemp -d); trap 'rm -rf \$tmp' EXIT; tar -xzf - -C \$tmp; rsync -a --delete \$tmp/ $SITE_DIR/"
      echo "Dosimeter updated" ;;
    cloudflare)
      npx wrangler deploy
      echo "Cloudflare updated" ;;
    *) echo "Unknown target: $target (use dosimeter or cloudflare)" >&2; exit 2 ;;
  esac
done

echo "Checking all three sites serve $bundle ..."
for url in https://maxy747.github.io/NILAVUS/ https://nilavus.mazinworlds.workers.dev/ https://nilavus.whydah-darter.ts.net/; do
  live=$(curl -fsS --max-time 15 "$url" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true)
  [ "$live" = "assets/$bundle" ] && echo "  OK        $url" || echo "  DIFFERENT $url (${live:-unreachable})"
done
