#!/bin/bash

# Variables à définir
IMAGE_NAME=${1:-pingouinfinihub/hypervisor-monitor}
IMAGE_TAG=${2:-3.1.0}

# Construire l'image avec docker-compose
docker-compose -f docker-compose.yml build

# Tagger l'image avec le nom et le tag choisis
docker tag "$IMAGE_NAME" "$IMAGE_NAME:$IMAGE_TAG"

# Pousser l'image sur le registre
docker push "$IMAGE_NAME:$IMAGE_TAG"

echo "Image $IMAGE_NAME:$IMAGE_TAG construite et poussée avec succès."