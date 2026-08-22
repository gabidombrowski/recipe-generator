# v5 moved the tunnel token off the tunnel resource and into its own data
# source; the output contract below stays the same.
data "cloudflare_zero_trust_tunnel_cloudflared_token" "app" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.app.id
}

output "tunnel_token" {
  description = <<-EOT
    The token the cloudflared container runs with. Put it in the server's .env as
    CLOUDFLARE_TUNNEL_TOKEN:

      terraform -chdir=infra output -raw tunnel_token

    Marked sensitive so it is not printed by a plain `terraform output`.
  EOT
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.app.token
  sensitive   = true
}

output "tunnel_id" {
  description = "Tunnel id, for cross-referencing in the Zero Trust dashboard."
  value       = cloudflare_zero_trust_tunnel_cloudflared.app.id
}

output "hostname" {
  description = "The public hostname now served through the tunnel."
  value       = var.hostname
}

output "auth_url" {
  description = "Value to set as AUTH_URL so Auth.js builds correct callback URLs behind the tunnel."
  value       = "https://${var.hostname}"
}
