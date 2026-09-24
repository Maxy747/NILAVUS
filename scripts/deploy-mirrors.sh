#!/usr/bin/env bash
# Publish the same NILAVUS build to the two mirrors. GitHub Pages deploys itself from
# main (.github/workflows/pages.yml); run this from a clean main checkout after pushing,
# so the Cloudflare Worker and Dosimeter serve the identical files.
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

# Refuse anything that isn't exactly the pushed main, or the mirrors would drift from GitHub Pages.
git fetch --quiet origin main
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy: the working tree has uncommitted changes." >&2
  exit 1
fi
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Refusing to deploy: check out main first (currently on $(git rev-parse --abbrev-ref HEAD))." >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Refusing to deploy: local main ($(git rev-parse --short HEAD)) differs from origin/main ($(git rev-parse --short origin/main))." >&2
  exit 1
fi

npm ci
npm run build
bundle=$(ls dist/assets | grep -E '^index-.*\.js$')
echo "Built $bundle from $(git rev-parse --short HEAD)"

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
status=0
for url in https://maxy747.github.io/NILAVUS/ https://nilavus.mazinworlds.workers.dev/ https://nilavus.whydah-darter.ts.net/; do
  live=$(curl -fsS --max-time 15 "$url" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 || true)
  if [ "$live" = "assets/$bundle" ]; then echo "  OK        $url"; else echo "  DIFFERENT $url (${live:-unreachable})"; status=1; fi
done
exit $status
