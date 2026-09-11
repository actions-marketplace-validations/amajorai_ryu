use ryu_backup::*;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(components(schemas(
    BackupDestination,
    SaveBackupDestination,
    BackupScope,
    BackupRecord,
    BackupPolicy,
    SaveBackupPolicy,
    CreateBackup,
    BackupOperation
)))]
struct Contract;

fn main() {
    println!(
        "{}",
        Contract::openapi()
            .to_pretty_json()
            .expect("Backup contract serializes")
    );
}
