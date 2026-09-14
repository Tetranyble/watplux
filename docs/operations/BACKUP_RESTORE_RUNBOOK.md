# Backup & Restore Runbook

## Database

Primary protection is the managed MySQL provider's automated backups and point-in-time recovery. Verify backup jobs/retention in provider controls; Watplux application code does not pretend that a local cron dump is equivalent to managed PITR.

For an additional pre-release logical dump on an operator host with `mysqldump` installed:

```bash
BACKUP_DIR=/secure/off-host/path npm run ops:backup:mysql
```

Copy the resulting `.sql.gz` to encrypted off-host storage with restricted access.

## Restore drill

At least before first production launch and periodically thereafter:

1. Provision an isolated non-production MySQL instance.
2. Restore a managed snapshot/PITR point (preferred) or approved logical dump.
3. Apply no ad-hoc schema edits.
4. Point a staging Watplux release at the restored database.
5. Verify `/api/ready`, login/RBAC, product reads, inventory/order reads and webhook-worker health.
6. Record restore duration and issues. The backup is not operationally trusted until this drill succeeds.

## Media

Enable S3-compatible bucket versioning. Database backup only preserves media metadata/keys; it does not contain image binaries. Restore deleted/replaced objects from object-version history according to the storage provider procedure.
