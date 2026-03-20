# Docker Buildx Bake definition for parallel image builds.
# Used by deploy-keeperhub.yaml via docker/bake-action to build the "app" and
# "migrator" targets from our Dockerfile concurrently in a single BuildKit
# session. Shared Dockerfile stages (deps, source) are built once and reused
# across both targets, saving ~47s vs sequential build-push-action steps.
# Variables are passed as env vars from the GHA workflow.
# Docs: https://docs.docker.com/build/bake/reference/

variable "ECR_REGISTRY" { default = "" }
variable "ECR_REPO" { default = "" }
variable "IMAGE_TAG" { default = "latest" }
variable "NEXT_PUBLIC_AUTH_PROVIDERS" { default = "" }
variable "NEXT_PUBLIC_GITHUB_CLIENT_ID" { default = "" }
variable "NEXT_PUBLIC_GOOGLE_CLIENT_ID" { default = "" }
variable "NEXT_PUBLIC_BILLING_ENABLED" { default = "" }
variable "ENVIRONMENT_TAG" { default = "" }
variable "EVENTS_ECR_TRACKER_REPO" { default = "" }
variable "EVENTS_ECR_WORKER_REPO" { default = "" }

group "default" {
  targets = ["app", "migrator"]
}

group "events" {
  targets = ["sc-event-tracker", "sc-event-worker"]
}

group "all" {
  targets = ["app", "migrator", "sc-event-tracker", "sc-event-worker"]
}

target "app" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "runner"
  args = {
    NEXT_PUBLIC_AUTH_PROVIDERS    = NEXT_PUBLIC_AUTH_PROVIDERS
    NEXT_PUBLIC_GITHUB_CLIENT_ID = NEXT_PUBLIC_GITHUB_CLIENT_ID
    NEXT_PUBLIC_GOOGLE_CLIENT_ID = NEXT_PUBLIC_GOOGLE_CLIENT_ID
    NEXT_PUBLIC_BILLING_ENABLED  = NEXT_PUBLIC_BILLING_ENABLED
  }
  tags = compact([
    "${ECR_REGISTRY}/${ECR_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${ECR_REPO}:app-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${ECR_REPO}:${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${ECR_REPO}:cache-app"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${ECR_REPO}:cache-app,mode=max"]
}

target "migrator" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "migrator"
  tags = [
    "${ECR_REGISTRY}/${ECR_REPO}:migrator-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${ECR_REPO}:migrator-latest",
  ]
  cache-from = [
    "type=registry,ref=${ECR_REGISTRY}/${ECR_REPO}:cache-app",
    "type=registry,ref=${ECR_REGISTRY}/${ECR_REPO}:cache-migrator",
  ]
  cache-to = ["type=registry,ref=${ECR_REGISTRY}/${ECR_REPO}:cache-migrator,mode=max"]
}

target "sc-event-tracker" {
  context    = "./keeperhub-events"
  dockerfile = "sc-event-tracker/Dockerfile"
  tags = [
    "${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:app-latest",
  ]
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:cache,mode=max"]
}

target "sc-event-worker" {
  context    = "./keeperhub-events"
  dockerfile = "sc-event-worker/Dockerfile"
  tags = [
    "${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:app-latest",
  ]
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:cache,mode=max"]
}
