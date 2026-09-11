const COMMANDS: &[&str] = &["pick_files", "pick_folder"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
