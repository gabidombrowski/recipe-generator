terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # v5, migrated from the v4 resource names in one pass: the provider's
      # ground-up rewrite renamed every resource here and reshaped Access
      # policies into account-level objects bound through the application.
      # CI runs `terraform validate` against this constraint, so a future
      # provider bump that breaks the schema fails visibly instead of
      # merging green.
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
