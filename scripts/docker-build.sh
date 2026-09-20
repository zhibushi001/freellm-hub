#!/bin/bash
# Build freellm-hub image with BuildKit 国内镜像加速
# 用法: DOCKER_BUILDKIT=1 ./scripts/docker-build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=plain

# 优先用项目级 buildkit 配置 (覆盖全局)
export BUILDKIT_CONFIG=/etc/buildkit/buildkitd.toml
if [ -f ./buildkitd.toml ]; then
  echo "==> Using project buildkitd.toml"
  export BUILDKIT_CONFIG="$(pwd)/buildkitd.toml"
fi

echo "==> Build context:"
echo "  BUILDKIT_CONFIG=$BUILDKIT_CONFIG"
echo "  Image: ${IMAGE_NAME:-freellm-hub:dev}"
echo

docker build \
  --build-arg BUILDKIT_SANDBOX_HOSTNAME=builder \
  -t "${IMAGE_NAME:-freellm-hub:dev}" \
  -f Dockerfile \
  .

echo
echo "==> Done. 启动: docker compose up -d"
