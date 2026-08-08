/**
 * Every identity, hostname and id is a variable.
 *
 * Nothing in this directory names a real person, domain or account — that is
 * what makes it safe in a public repo. Real values live in `terraform.tfvars`,
 * which is gitignored; `terraform.tfvars.example` shows the shape.
 */

variable "cloudflare_account_id" {
  description = "Cloudflare account id that owns the tunnel and the Access application."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone id for the domain the app is published under."
  type        = string
}

variable "hostname" {
  description = "Public hostname, e.g. nutrition.example.com. Must sit inside the zone above."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.hostname))
    error_message = "hostname must be a fully-qualified domain name."
  }
}

variable "allowed_email" {
  description = "The single email address permitted through Cloudflare Access. Must match the app's ALLOWED_EMAIL."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.allowed_email))
    error_message = "allowed_email must be a single email address."
  }
}

variable "tunnel_name" {
  description = "Name shown in the Cloudflare Zero Trust dashboard."
  type        = string
  default     = "recipe-generator"
}

variable "origin_url" {
  description = "Where cloudflared forwards to. Inside the compose network this is the app service; under pm2 it is a loopback port."
  type        = string
  default     = "http://app:3000"
}

variable "session_duration" {
  description = "How long a Cloudflare Access session lasts before re-authentication."
  type        = string
  default     = "24h"
}
