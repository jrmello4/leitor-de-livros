const COMMANDS: &[&str] = &[
    "check_update",
    "download_and_install",
    "get_installed_version",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
