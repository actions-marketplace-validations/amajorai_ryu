#!/usr/bin/env bash
# Assemble a Tauri updater feed (`latest-<channel>.json`) for a ROLLING release
# channel, from the artifacts that channel's own release already carries.
#
# Why this exists
# ---------------
# The desktop's `install_update_from_channel` dials a fixed per-channel feed URL.
# Until this script ran, no rolling channel published one, so the desktop fell
# back to the Stable feed copied onto the Stable release — meaning a user who
# opted into `nightly` was offered the *Stable* build. Safe (always signed, never
# a downgrade) but not the channel they asked for.
#
# It cannot be solved with `/releases/latest/download/...`: GitHub defines
# `/latest` to EXCLUDE prereleases, and every rolling build is a prerelease. What
# makes a fixed URL possible is that the rolling channels publish to a *rolling
# tag* (`nightly` / `canary`) that CI force-moves each run, so
# `/releases/download/<channel>/latest-<channel>.json` is stable forever.
#
# Feed shape (tauri-plugin-updater v2):
#   { "version": "...", "pub_date": "...", "platforms": {
#       "<os>-<arch>": { "signature": "<contents of the .sig>", "url": "..." } } }
#
# The signature is the LITERAL CONTENT of the artifact's `.sig` file, which the
# updater verifies against the pubkey baked into tauri.conf.json. This script
# therefore emits a platform entry ONLY when both the artifact and its `.sig` are
# present — an entry without a valid signature would make the updater reject the
# download at install time, which reads to the user as a broken updater rather
# than a missing build.
#
# Usage: assemble-channel-feed.sh <channel> <version> [repo] [release-tag]
#   channel      rolling tag + feed name (nightly | canary), or `stable`
#   version      the version this build stamped (e.g. 0.0.18-nightly.20260802.23)
#   repo         owner/name, defaults to $GITHUB_REPOSITORY
#   release-tag  the tag to READ assets from and publish to. Defaults to <channel>
#                (correct for the rolling channels, whose tag IS the channel name).
#                `stable` has no rolling tag, so it MUST be given one — e.g.
#                `assemble-channel-feed.sh stable 0.1.0 amajorai/ryu v0.1.0`,
#                which writes `latest.json`, the feed tauri.conf.json points at.
set -euo pipefail

channel="${1:?usage: assemble-channel-feed.sh <channel> <version> [repo]}"
version="${2:?missing version}"
repo="${3:-${GITHUB_REPOSITORY:?missing repo}}"

# Only the rolling channels have their own build train. `beta` deliberately has
# none and keeps falling back to the Stable feed, so refuse it here rather than
# publishing an empty feed that would silently stop offering updates.
release_tag="${4:-$channel}"

# `stable` is the app's own updater feed (`latest.json`), so it is named
# differently and cannot infer its tag — a stable release has a real version tag,
# not a rolling pointer.
case "$channel" in
	nightly | canary) feed_name="latest-$channel.json" ;;
	stable)
		feed_name="latest.json"
		if [ "$release_tag" = "stable" ]; then
			echo "assemble-channel-feed: 'stable' needs an explicit release tag" >&2
			exit 1
		fi
		;;
	*)
		echo "assemble-channel-feed: '$channel' has no rolling build train" >&2
		exit 1
		;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

assets="$(gh release view "$release_tag" -R "$repo" --json assets --jq '.assets[].name')"

# Map a Tauri updater platform key to the artifact that serves it. macOS ships
# the updater bundle as `.app.tar.gz`; the two arch legs would otherwise both be
# named `Ryu.app.tar.gz` and clobber each other on a single release, so the
# workflow renames them per-arch before upload and we match that here.
platform_artifact() {
	case "$1" in
		# Every workflow renames per-arch before upload (two macOS legs would
		# otherwise both be `<productName>.app.tar.gz` and clobber each other,
		# losing one arch's updater bundle on every run). The un-suffixed fallback
		# is for releases cut BEFORE that rename existed — v0.1.0 and earlier carry
		# a single bundle, and treating it as aarch64 is right because macos-latest
		# builds ARM. New releases populate both entries.
		#
		# Matched by SUFFIX, not by the literal name: `channel-brand.mjs` stamps the
		# channel into productName, so the bundle is `Ryu Research Preview-aarch64
		# .app.tar.gz` on stable, not `Ryu-aarch64.app.tar.gz`. The literal match
		# silently stopped resolving when branding landed, and because a missing
		# artifact is *omitted* rather than fatal, v0.1.5's latest.json shipped with
		# only linux and windows — every macOS user was offered no update at all,
		# and nothing failed. Suffix matching is what linux/windows already do.
		darwin-aarch64)
			match="$(echo "$assets" | grep -E -- '-aarch64\.app\.tar\.gz$' | head -n1 || true)"
			if [ -z "$match" ]; then
				# Pre-rename releases: a single bundle with no arch suffix.
				match="$(echo "$assets" | grep -E '\.app\.tar\.gz$' \
					| grep -Ev -- '-(aarch64|x86_64)\.app\.tar\.gz$' | head -n1 || true)"
			fi
			echo "$match"
			;;
		darwin-x86_64) echo "$assets" | grep -E -- '-x86_64\.app\.tar\.gz$' | head -n1 || true ;;
		# Linux and Windows are single-arch in the rolling matrix. Matched by
		# suffix because the filename carries the version, which changes per build.
		#
		# `|| true` is load-bearing: under `set -euo pipefail` a grep that matches
		# nothing exits 1, which would abort the WHOLE script instead of omitting
		# just that platform — turning "one build leg failed" into "no feed at all",
		# the exact case the caller's `if: always()` exists to survive.
		linux-x86_64) echo "$assets" | grep -E '_amd64\.AppImage$' | head -n1 || true ;;
		windows-x86_64) echo "$assets" | grep -E '_x64-setup\.exe$' | head -n1 || true ;;
	esac
}

platforms_json="{}"
found=0
for key in darwin-aarch64 darwin-x86_64 linux-x86_64 windows-x86_64; do
	artifact="$(platform_artifact "$key")"
	if [ -z "$artifact" ]; then
		echo "  - $key: no artifact on the '$release_tag' release — omitted" >&2
		continue
	fi
	if ! echo "$assets" | grep -qxF "$artifact"; then
		echo "  - $key: '$artifact' missing — omitted" >&2
		continue
	fi
	if ! echo "$assets" | grep -qxF "$artifact.sig"; then
		# Signing is secret-gated: with no key configured tauri-action emits the
		# installer but no .sig. Emitting the entry anyway would ship a feed the
		# updater rejects at verify time.
		echo "  - $key: '$artifact.sig' missing (signing off?) — omitted" >&2
		continue
	fi

	gh release download "$release_tag" -R "$repo" -p "$artifact.sig" -D "$work" --clobber
	signature="$(cat "$work/$artifact.sig")"
	url="https://github.com/$repo/releases/download/$release_tag/$artifact"

	entry="$(jq -n --arg sig "$signature" --arg url "$url" \
		'{signature: $sig, url: $url}')"
	platforms_json="$(jq -n \
		--argjson acc "$platforms_json" \
		--arg key "$key" \
		--argjson entry "$entry" \
		'$acc + {($key): $entry}')"
	found=$((found + 1))
	echo "  + $key -> $artifact" >&2
done

if [ "$found" -eq 0 ]; then
	# Publishing an empty feed would make the updater report "no update" forever.
	# Leaving the previous feed in place keeps the last good build on offer.
	echo "assemble-channel-feed: no signed artifacts on '$release_tag' — leaving the existing feed untouched" >&2
	exit 0
fi

out="$work/$feed_name"
jq -n \
	--arg version "$version" \
	--arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	--argjson platforms "$platforms_json" \
	'{version: $version, pub_date: $pub_date, platforms: $platforms}' >"$out"

cat "$out" >&2
gh release upload "$release_tag" -R "$repo" "$out" --clobber
echo "assemble-channel-feed: published $feed_name on $release_tag ($found platform(s))" >&2
