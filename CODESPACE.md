# Codespace workflow (backup account)

The primary repo is **allenabundiente/CodeQuest**. Render deploys from it. The
backup mirror **Des-troy09/CodeQuest** is one-directional: primary → backup.

## What the Codespace is for

Use a Codespace opened from `Des-troy09/CodeQuest` for development and staging
experiments. It is not a deployment source and must never be merged back
directly into itself. The flow is:

1. Open a Codespace from the backup repo.
2. Create a branch in that Codespace for your work.
3. Push the branch to the **primary** repo and open a PR into `main` there.
4. Once merged, the mirror workflow copies `main` back to the backup repo.
5. Pull the mirrored `main` into the Codespace before starting the next task.

Never push directly to the backup `main`. The mirror job force-free pushes
`HEAD:main`; a divergent backup branch will make the mirror fail loudly rather
than overwrite work.

## Secrets

Set development-only values in **GitHub → Codespaces → Repository secrets** for
the backup repo. Use a Supabase development project and development AI keys.
Never put production keys, the Render API key, or the backup deploy private key
in a Codespace.

## Emergency recovery

If the primary repo is unavailable, clone the backup directly:

```bash
git clone git@github.com:Des-troy09/CodeQuest.git
cd CodeQuest
git remote add primary git@github.com:allenabundiente/CodeQuest.git
```

Use the backup only as a read-only recovery source. Restore the primary repo
first, then resume the one-directional mirror; do not make the backup the new
source of truth.

## Recreating the mirror

The public deploy key for the backup repo is:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILD7rM/I08UYCaD00QZpbHxBi7YDazGTepmyG5X5btL1 u0_a178@localhost
```

Register it under **Des-troy09/CodeQuest → Settings → Deploy keys → Allow write
access**. Store the private half only as the primary repo secret
`BACKUP_DEPLOY_KEY`. The workflow writes it to `~/.ssh/backup_key` with mode 600;
it is never committed or printed.
