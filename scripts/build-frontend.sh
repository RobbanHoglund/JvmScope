#!/bin/sh
set -ex

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/../frontend"

NODE_VERSION=v22.16.0

NODE_FILENAME=node-${NODE_VERSION}-linux-x64.tar.gz
NODE_CHECKSUM=fb870226119d47378fa9c92c4535389c72dae14fcc7b47e6fdcc82c43de5a547

if [ "$1" = "--ci" ]; then
  echo "Running in CI mode"
  mkdir -p downloads
  curl --fail --location https://nodejs.org/dist/$NODE_VERSION/$NODE_FILENAME --output downloads/$NODE_FILENAME
  echo $NODE_CHECKSUM downloads/$NODE_FILENAME | sha256sum -c -
  mkdir -p node
  tar -xzf downloads/$NODE_FILENAME -C node/
  export PATH=$(pwd)/node/node-${NODE_VERSION}-linux-x64/bin:$PATH

  npm ci --verbose
  npm run build:ci
else
  echo "Running in local mode"
  npm run build:all
fi
