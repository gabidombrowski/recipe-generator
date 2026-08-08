output "tunnel_token" {
  description = <<-EOT
    The token the cloudflared container runs with. Put it in the server's .env as
    CLOUDFLARE_TUNNEL_TOKEN:

      terraform -chdir=infra output -raw tunnel_token

    Marked sensitive so it is not printed by a plain `terraform output`.
  EOT
  value       = cloudflare_tunnel.app.tunnel_token
  sensitive   = true
}

output "tunnel_id" {
  description = "Tunnel id, for cross-referencing in the Zero Trust dashboard."
  value       = cloudflare_tunnel.app.id
}

output "hostname" {
  description = "The public hostname now served through the tunnel."
  value       = var.hostname
}

output "auth_url" {
  description = "Value to set as AUTH_URL so Auth.js builds correct callback URLs behind the tunnel."
  value       = "https://${var.hostname}"
}
