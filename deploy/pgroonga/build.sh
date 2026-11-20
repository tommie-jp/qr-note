#!/bin/bash
# 公式 github.com/pgroonga/docker の alpine/build.sh (commit 0654f9d) の写し。
# 差分: set -euo pipefail・ソースの sha256 照合。
#
# sha256 は 2026-11-20 に packages.groonga.org から落とし、Groonga 公式鍵
# (2701 F317 CFCC CB97 5CAD E9C2 624C F774 3483 9225、
#  https://packages.groonga.org/centos/RPM-GPG-KEY-34839225) で .asc の署名が
# Good になったものの値。版を上げたら同じ手順で取り直す:
#   curl -sLO <url>; curl -sLO <url>.asc; gpg --verify <file>.asc <file>; sha256sum <file>

set -euxo pipefail

PGROONGA_VERSION=$1
GROONGA_VERSION=$2

declare -A SHA256=(
  [groonga-16.1.3.tar.gz]=61e1c8f1671e22d7bf4cd8c35002b9674d29ba82ae2cbe6835d73d3a45af202b
  [pgroonga-4.1.0.tar.gz]=0ce8d58e73820bb74e82882afa58d6c0c5c46d43ae8349c6fc05c7097b85ee40
)

fetch() {
  local url=$1 file=${1##*/}
  local want=${SHA256[$file]:-}
  if [ -z "$want" ]; then
    echo "ERROR: $file の sha256 が build.sh に無い (版を上げたら SHA256 も足す)" >&2
    exit 1
  fi
  wget -q "$url"
  echo "$want  $file" | sha256sum -c -
}

mkdir build
pushd build

fetch https://packages.groonga.org/source/groonga/groonga-${GROONGA_VERSION}.tar.gz
tar xf groonga-${GROONGA_VERSION}.tar.gz
pushd groonga-${GROONGA_VERSION}

pushd vendor
ruby download_mecab.rb
popd

cmake \
  -S . \
  -B ../groonga.build \
  --preset=release-maximum \
  -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build ../groonga.build
cmake --install ../groonga.build
popd

fetch https://packages.groonga.org/source/pgroonga/pgroonga-${PGROONGA_VERSION}.tar.gz
tar xf pgroonga-${PGROONGA_VERSION}.tar.gz
pushd pgroonga-${PGROONGA_VERSION}
meson setup ../pgroonga.build .
meson compile -C ../pgroonga.build
meson install -C ../pgroonga.build
popd

popd
rm -rf build
