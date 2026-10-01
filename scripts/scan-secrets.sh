#!/usr/bin/env bash
set -euo pipefail

# Pin both release and bytes; no floating installer or action.
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    scan_platform=linux_x64
    scan_checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    ;;
  Linux/aarch64)
    scan_platform=linux_arm64
    scan_checksum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
    ;;
  *) echo "Secret scanner installer requires Linux x64 or arm64." >&2; exit 2 ;;
esac
scan_root=$(git rev-parse --show-toplevel)
scan_temp=$(mktemp -d)
trap 'rm -rf "$scan_temp"' EXIT
umask 077
scan_archive="$scan_temp/gitleaks.tar.gz"
curl --fail --silent --show-error --location --retry 2 --max-time 60 \
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_${scan_platform}.tar.gz" \
  --output "$scan_archive"
printf '%s  %s\n' "$scan_checksum" "$scan_archive" | sha256sum --check --status
tar -xzf "$scan_archive" -C "$scan_temp" gitleaks
scan_binary="$scan_temp/gitleaks"
scan_flags=(--config "$scan_root/.gitleaks.toml" --redact=100 --no-banner --no-color --ignore-gitleaks-allow --timeout 120)

# Prove the pinned scanner rejects a synthetic credential, even with an inline
# suppression comment. This fixture never contacts an authentication provider.
mkdir "$scan_temp/fixture"
printf 'const harmless = "public"\n' > "$scan_temp/fixture/sample.js"
"$scan_binary" dir "${scan_flags[@]}" --log-level error "$scan_temp/fixture"
printf 'const token = "ghp_%s" // gitleaks:allow\n' \
  4mQ8sR2vL7cN5xB9aD3fH6jK1pT0wY2zE8uV > "$scan_temp/fixture/sample.js"
scan_status=0
"$scan_binary" dir "${scan_flags[@]}" --log-level error --exit-code 42 \
  "$scan_temp/fixture" || scan_status=$?
[[ "$scan_status" == 42 ]] || {
  echo "Secret scanner detection control failed." >&2
  exit 2
}

# History is intentional: removing a credential later does not remove exposure.
[[ "$(git -C "$scan_root" rev-parse --is-shallow-repository)" == false ]] || {
  echo "Secret scanning requires complete Git history." >&2
  exit 2
}
"$scan_binary" git "${scan_flags[@]}" --gitleaks-ignore-path "$scan_root/.gitleaksignore" \
  --log-opts HEAD "$scan_root"
