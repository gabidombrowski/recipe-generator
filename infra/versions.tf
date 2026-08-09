terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # Pinned to v4. The v5 provider renamed most Zero Trust resources
      # (`cloudflare_tunnel` -> `cloudflare_zero_trust_tunnel_cloudflared`,
      # `cloudflare_record` -> `cloudflare_dns_record`, and so on). Upgrading is
      # a deliberate migration, not a version bump — pin until it is done.
      version = "~> 5.23"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State contains the tunnel secret, so it must not be committed — see the
  # root .gitignore. For a durable backend, uncomment and fill in:
  #
  # backend "s3" {
  #   bucket = "your-tfstate-bucket"
  #   key    = "recipe-generator/terraform.tfstate"
  #   region = "auto"
  #   # Cloudflare R2 works here via endpoints + skip_* flags; any S3-compatible
  #   # store does. The point is that state lives somewhere backed up and
  #   # lockable rather than on one laptop.
  # }
}

provider "cloudflare" {
  # From the CLOUDFLARE_API_TOKEN environment variable. Never a literal, and
  # never a tfvars entry that could be pasted into a commit.
  # Token needs: Zone:DNS:Edit, Account:Cloudflare Tunnel:Edit,
  # Account:Access: Apps and Policies:Edit.
}
