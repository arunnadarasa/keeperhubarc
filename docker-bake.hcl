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
variable "EVENTS_ECR_EXECUTOR_REPO" { default = "" }
variable "SCHEDULER_ECR_REPO" { default = "" }
variable "EXECUTOR_ECR_REPO" { default = "" }

group "default" {
  targets = ["app", "migrator"]
}

group "events" {
  targets = ["sc-event-tracker", "sc-event-worker"]
}

group "scheduler" {
  targets = ["schedule-dispatcher", "schedule-executor", "block-dispatcher"]
}

group "all" {
  targets = ["app", "migrator", "sc-event-tracker", "sc-event-worker", "schedule-dispatcher", "schedule-executor", "block-dispatcher", "executor"]
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
  tags = compact([
    "${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:app-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_TRACKER_REPO}:cache,mode=max"]
  attest     = []
}

target "sc-event-worker" {
  context    = "./keeperhub-events"
  dockerfile = "sc-event-worker/Dockerfile"
  tags = compact([
    "${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:app-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_WORKER_REPO}:cache,mode=max"]
  attest     = []
}

target "event-executor" {
  context    = "./keeperhub-events"
  dockerfile = "event-executor/Dockerfile"
  tags = compact([
    "${ECR_REGISTRY}/${EVENTS_ECR_EXECUTOR_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EVENTS_ECR_EXECUTOR_REPO}:app-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${EVENTS_ECR_EXECUTOR_REPO}:${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_EXECUTOR_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EVENTS_ECR_EXECUTOR_REPO}:cache,mode=max"]
  attest     = []
}

target "schedule-dispatcher" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "schedule-dispatcher"
  tags = compact([
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:dispatcher-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:dispatcher-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:dispatcher-${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = [
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-deps",
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-dispatcher",
  ]
  cache-to = ["type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-dispatcher,mode=max"]
  attest   = []
}

target "schedule-executor" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "schedule-executor"
  tags = compact([
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:executor-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:executor-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:executor-${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = [
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-deps",
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-executor",
  ]
  cache-to = ["type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-executor,mode=max"]
  attest   = []
}

target "block-dispatcher" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "block-dispatcher"
  tags = compact([
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:block-dispatcher-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:block-dispatcher-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:block-dispatcher-${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = [
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-deps",
    "type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-block-dispatcher",
  ]
  cache-to = ["type=registry,ref=${ECR_REGISTRY}/${SCHEDULER_ECR_REPO}:cache-block-dispatcher,mode=max"]
  attest   = []
}

target "executor" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "executor"
  tags = compact([
    "${ECR_REGISTRY}/${EXECUTOR_ECR_REPO}:app-${IMAGE_TAG}",
    "${ECR_REGISTRY}/${EXECUTOR_ECR_REPO}:app-latest",
    ENVIRONMENT_TAG != "" ? "${ECR_REGISTRY}/${EXECUTOR_ECR_REPO}:${ENVIRONMENT_TAG}" : "",
  ])
  cache-from = ["type=registry,ref=${ECR_REGISTRY}/${EXECUTOR_ECR_REPO}:cache"]
  cache-to   = ["type=registry,ref=${ECR_REGISTRY}/${EXECUTOR_ECR_REPO}:cache,mode=max"]
  attest     = []
}
