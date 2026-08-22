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

resource "cloudflare_zero_trust_tunnel_cloudflared" "app" {
  account_id    = var.cloudflare_account_id
  name          = var.tunnel_name
  tunnel_secret = base64encode(random_password.tunnel_secret.result)
  config_src    = "cloudflare"
}

# Routes the public hostname to the local origin. Everything else 404s at the
# edge rather than reaching the app.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "app" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.app.id

  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = var.origin_url
      },
      # cloudflared requires a catch-all as the final rule.
      {
        service = "http_status:404"
      },
    ]
  }
}

# Points the hostname at the tunnel. Proxied is required — an unproxied record
# would expose the origin directly and defeat the whole arrangement. TTL 1 is
# "automatic", the only valid choice for a proxied record.
resource "cloudflare_dns_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.hostname
  ttl     = 1
  content = "${cloudflare_zero_trust_tunnel_cloudflared.app.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  comment = "Managed by Terraform — recipe-generator tunnel"
}

resource "cloudflare_zero_trust_access_application" "app" {
  zone_id          = var.cloudflare_zone_id
  name             = var.tunnel_name
  domain           = var.hostname
  type             = "self_hosted"
  session_duration = var.session_duration

  # The app renders its own sign-in page; Access should not add a second one
  # beyond its identity check.
  auto_redirect_to_identity = true
  app_launcher_visible      = false

  # v5 policies are account-level and reusable; precedence moved here, onto
  # the application that binds them.
  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.allow_owner.id
      precedence = 1
    },
    {
      id         = cloudflare_zero_trust_access_policy.deny_everyone_else.id
      precedence = 2
    },
  ]
}

# The allowlist. One address, and an explicit deny for everyone else — a policy
# that only allows would leave the default to Cloudflare's, which is not a
# default worth inheriting for a personal app.
resource "cloudflare_zero_trust_access_policy" "allow_owner" {
  account_id = var.cloudflare_account_id
  name       = "Owner only"
  decision   = "allow"

  include = [{
    email = { email = var.allowed_email }
  }]
}

resource "cloudflare_zero_trust_access_policy" "deny_everyone_else" {
  account_id = var.cloudflare_account_id
  name       = "Deny all others"
  decision   = "deny"

  include = [{
    everyone = {}
  }]
}
