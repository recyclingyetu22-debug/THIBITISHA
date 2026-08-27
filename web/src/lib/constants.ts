// The mobile APK is a 140MB build artifact — too large for a normal git
// commit (GitHub's push limit is 100MB) and deliberately gitignored (see
// repo root .gitignore). It's hosted as a GitHub Release asset instead,
// which supports files up to 2GB and gives it a stable public URL that
// works from any deploy (Railway, or anywhere else) without needing to be
// part of the build.
export const MOBILE_APK_URL =
  "https://github.com/recyclingyetu22-debug/THIBITISHA/releases/download/mobile-v1/thibitisha-mobile.apk";
