/**
 * Public exposure with no inbound ports.
 *
 * cloudflared dials out from the server and holds the connection open, so the
 * host needs no port forward and no inbound firewall rule. Cloudflare Access
 * authenticates in front of the tunnel, and the app's own allowlist
 * authenticates again behind it. Two independent layers, either of which alone
 * would keep everyone else out.
 */

# The tunnel's shared secret. Generated here so it never has to be typed,
# pasted, or stored anywhere but the state file.
resource "random_password" "tunnel_secret" {
  length  = 64
  special = false
}

resource "cloudflare_tunnel" "app" {
  account_id = var.cloudflare_account_id
  name       = var.tunnel_name
  secret     = base64encode(random_password.tunnel_secret.result)
  config_src = "cloudflare"
}

# Routes the public hostname to the local origin. Everything else 404s at the
# edge rather than reaching the app.
resource "cloudflare_tunnel_config" "app" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_tunnel.app.id

  config {
    ingress_rule {
      hostname = var.hostname
      service  = var.origin_url
    }

    # cloudflared requires a catch-all as the final rule.
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# Points the hostname at the tunnel. Proxied is required — an unproxied record
# would expose the origin directly and defeat the whole arrangement.
resource "cloudflare_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.hostname
  content = "${cloudflare_tunnel.app.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  comment = "Managed by Terraform — recipe-generator tunnel"
}

resource "cloudflare_access_application" "app" {
  zone_id          = var.cloudflare_zone_id
  name             = var.tunnel_name
  domain           = var.hostname
  type             = "self_hosted"
  session_duration = var.session_duration

  # The app renders its own sign-in page; Access should not add a second one
  # beyond its identity check.
  auto_redirect_to_identity = true
  app_launcher_visible      = false
}

# The allowlist. One address, and an explicit deny for everyone else — a policy
# that only allows would leave the default to Cloudflare's, which is not a
# default worth inheriting for a personal app.
resource "cloudflare_access_policy" "allow_owner" {
  application_id = cloudflare_access_application.app.id
  zone_id        = var.cloudflare_zone_id
  name           = "Owner only"
  precedence     = 1
  decision       = "allow"

  include {
    email = [var.allowed_email]
  }
}

resource "cloudflare_access_policy" "deny_everyone_else" {
  application_id = cloudflare_access_application.app.id
  zone_id        = var.cloudflare_zone_id
  name           = "Deny all others"
  precedence     = 2
  decision       = "deny"

  include {
    everyone = true
  }
}
