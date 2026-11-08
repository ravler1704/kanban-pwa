#!/bin/sh
# Builds the Android app (Trusted Web Activity) into android/offline-kanban.apk and .aab.
# Needs JDK 17, the Android SDK and Bubblewrap (see README), and the signing key in deploy/android/.
# Raise appVersionCode/appVersionName in twa-manifest.json before building an update.
set -e
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
set -a
. ../deploy/android/keystore.env
set +a
bubblewrap update --skipVersionUpgrade
bubblewrap build --skipPwaValidation
mv app-release-signed.apk offline-kanban.apk
mv app-release-bundle.aab offline-kanban.aab
rm -f app-release-unsigned-aligned.apk
echo "Built android/offline-kanban.apk and android/offline-kanban.aab"
